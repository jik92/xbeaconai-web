import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, relative, resolve } from "node:path";
import { env } from "../../server/env";
import { probeMedia } from "../../server/media/ffmpeg";
import { VolcSpeechError, volcSpeech } from "../../server/providers/volc-speech";
import { ossutils } from "../../server/storage/ossutils";
import type { JobRecord, JobResult, StageProvenance } from "../../server/types";
import { isVoicePresetId } from "../../shared/voice/preset-voices";
import { isVoicePresetStyle, voicePresetStyleInstruction } from "../../shared/voice/preset-styles";
import type { JobHandlerContext, WorkerJobHandler } from "./types";

const languageMap: Record<string, number> = { 普通话: 0, 粤语: 0, English: 1, 多语言: 0 };
const formatMap: Record<string, string> = {
  ".wav": "wav",
  ".mp3": "mp3",
  ".ogg": "ogg",
  ".m4a": "m4a",
  ".aac": "aac",
  ".pcm": "pcm",
};

function detectAudio(bytes: Uint8Array) {
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46)
    return { extension: "wav", mimeType: "audio/wav" };
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53)
    return { extension: "ogg", mimeType: "audio/ogg" };
  return { extension: "mp3", mimeType: "audio/mpeg" };
}

const synthesisLanguage: Record<string, { language?: string; dialect?: string }> = {
  自动识别: {},
  普通话: { language: "zh" },
  English: { language: "en" },
  粤语: { language: "zh", dialect: "yue" },
};

function failVoiceJob(job: JobRecord, context: JobHandlerContext, error: unknown, stage: string) {
  const provider = error instanceof VolcSpeechError ? error : undefined;
  const providerOutcomeUnknown = new Set([
    "VOLC_SPEECH_EMPTY_RESPONSE",
    "VOLC_SPEECH_INVALID_RESPONSE",
    "VOLC_SPEECH_INCOMPLETE_AUDIO",
  ]).has(provider?.code ?? "");
  const patch: Partial<JobRecord> = {
    status: provider?.code === "VOICE_CLONE_CANCELLED" ? "cancelled" : "failed",
    stage: provider?.code === "VOICE_CLONE_CANCELLED" ? "已取消" : stage,
    error:
      provider?.code === "VOICE_CLONE_CANCELLED"
        ? undefined
        : {
            code: provider?.code ?? "VOICE_TASK_FAILED",
            message: error instanceof Error ? error.message : stage,
            retryable: provider?.retryable ?? true,
            requestId: provider?.logId ?? crypto.randomUUID(),
          },
  };
  if (provider && !providerOutcomeUnknown && provider.code !== "VOICE_CLONE_CANCELLED") patch.providerStatus = "failed";
  context.change(job.id, patch);
}

async function executeSynthesis(job: JobRecord, context: JobHandlerContext) {
  const { accounts, store } = context;
  try {
    if (!accounts) throw new Error("素材所有权服务不可用");
    if (!volcSpeech.configured)
      throw new VolcSpeechError("VOLC_SPEECH_NOT_CONFIGURED", "火山引擎语音 API Key 未配置", false);
    if (job.providerSubmittedAt)
      throw new VolcSpeechError(
        "VOICE_SYNTHESIS_SUBMISSION_UNKNOWN",
        "上次合成请求的结果未知，请先核对账单和产物，再由用户手动重试",
        false,
      );

    const voiceSource = job.values.voiceSource === "preset" ? "preset" : "cloned";
    const speaker = (voiceSource === "preset" ? job.values.presetVoiceId : job.values.synthesisSpeakerId)?.trim() ?? "";
    if (!speaker) throw new VolcSpeechError("VOICE_SPEAKER_REQUIRED", "请选择预置音色或填写克隆音色 ID", false);
    if (voiceSource === "preset" && !isVoicePresetId(speaker))
      throw new VolcSpeechError("VOICE_PRESET_NOT_SUPPORTED", "所选预置音色不在当前已验证目录中", false);
    if (voiceSource === "cloned" && job.values.authorized !== "true")
      throw new VolcSpeechError("VOICE_CONSENT_REQUIRED", "必须确认拥有该克隆音色的合成授权", false);
    if (voiceSource === "cloned" && (job.values.consentReference?.trim().length ?? 0) < 3)
      throw new VolcSpeechError("VOICE_CONSENT_REFERENCE_REQUIRED", "必须填写可核验的授权记录编号", false);
    if (voiceSource === "cloned" && !["允许正式合成", "允许商业发布"].includes(job.values.consentScope ?? ""))
      throw new VolcSpeechError("VOICE_CONSENT_SCOPE_INVALID", "授权范围未包含正式语音合成", false);
    const text = job.values.synthesisText?.trim() ?? "";
    if (!text || text.length > 1_000) throw new VolcSpeechError("VOICE_TEXT_INVALID", "合成文本需为 1–1000 字", false);
    const speechRate = Number(job.values.speechRate ?? 0);
    if (!Number.isInteger(speechRate) || speechRate < -50 || speechRate > 100)
      throw new VolcSpeechError("VOICE_SPEECH_RATE_INVALID", "语速需为 -50 到 100 之间的整数", false);
    const style = job.values.synthesisStyle || "自然";
    if (!isVoicePresetStyle(style)) throw new VolcSpeechError("VOICE_STYLE_INVALID", "请选择系统提供的配音风格", false);
    const contextText = voicePresetStyleInstruction(style);
    const language = synthesisLanguage[job.values.synthesisLanguage || "自动识别"] ?? {};
    if (store.get(job.id)?.cancelRequested) throw new VolcSpeechError("VOICE_CLONE_CANCELLED", "任务已取消", false);
    const requestId = crypto.randomUUID();
    const stage: StageProvenance = {
      id: `${job.id}:synthesize`,
      capability: "speech-synthesize",
      executionMode: "real",
      implementation: "volc-tts-v3-unidirectional",
      provider: "volcengine",
      model: voiceSource === "preset" ? env.volcSpeech.presetTtsResourceId : env.volcSpeech.ttsResourceId,
      startedAt: new Date().toISOString(),
    };
    context.change(job.id, {
      status: "processing",
      stage: "正在生成语音",
      progress: 20,
      executionPlan: [stage],
      provenance: [stage],
      overallExecutionMode: "real",
      providerTaskId: requestId,
      providerStatus: "submitting",
      providerSubmittedAt: new Date().toISOString(),
      values: { ...job.values, synthesisRequestId: requestId, resolvedSynthesisSpeakerId: speaker },
    });

    const synthesis = await volcSpeech.synthesize({
      requestId,
      resourceId: voiceSource === "preset" ? env.volcSpeech.presetTtsResourceId : env.volcSpeech.ttsResourceId,
      speaker,
      text,
      model: contextText ? "seed-tts-2.0-expressive" : "seed-tts-2.0-standard",
      speechRate,
      explicitLanguage: language.language,
      explicitDialect: language.dialect,
      contextText,
      toneFidelity: voiceSource === "cloned" && job.values.toneFidelity === "true",
    });
    context.change(job.id, { stage: "校验并保存音频", progress: 85, providerStatus: "received" });
    if (store.get(job.id)?.cancelRequested)
      throw new VolcSpeechError("VOICE_CLONE_CANCELLED", "任务已取消", false, synthesis.logId);
    const name = `${job.id}-speech.mp3`;
    const outputPath = resolve(env.dataDir, "results", name);
    await Bun.write(outputPath, synthesis.bytes);
    const media = await probeMedia(outputPath);
    const duration = Number(media.format.duration ?? 0);
    if (!Number.isFinite(duration) || duration <= 0)
      throw new VolcSpeechError("VOICE_SYNTHESIS_AUDIO_INVALID", "合成音频无法解码或时长为空", true, synthesis.logId);
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(synthesis.bytes);
    const outputSha256 = hasher.digest("hex");
    const artifactId = crypto.randomUUID();
    accounts.createArtifact({
      id: artifactId,
      ownerUserId: job.ownerUserId,
      jobId: job.id,
      storageKey: name,
      name,
      mimeType: "audio/mpeg",
      createdAt: new Date().toISOString(),
    });
    stage.completedAt = new Date().toISOString();
    const result: JobResult = {
      kind: "voice-synthesis",
      title: job.title,
      summary: `已使用${voiceSource === "preset" ? "预置" : "克隆"}音色生成真实语音。`,
      artifacts: [
        {
          id: artifactId,
          name,
          mimeType: "audio/mpeg",
          url: `/api/artifacts/${artifactId}`,
          executionMode: "real",
          lineage: [stage],
        },
      ],
      data: {
        values: {
          ...job.values,
          synthesisRequestId: requestId,
          resolvedSynthesisSpeakerId: speaker,
          outputSha256,
          outputDurationSec: duration.toFixed(3),
        },
        generatedAt: new Date().toISOString(),
        mock: false,
      },
    };
    context.change(job.id, {
      status: "succeeded",
      stage: "语音生成完成",
      progress: 100,
      provenance: [stage],
      result,
      values: result.data?.values ?? job.values,
      overallExecutionMode: "real",
      providerStatus: "succeeded",
    });
    if (accounts.taskNotificationsEnabled(job.ownerUserId))
      accounts.createNotification(job.ownerUserId, "task_completed", "语音生成完成", `${job.title} 已可试听。`, job.id);
  } catch (error) {
    failVoiceJob(job, context, error, "语音生成失败");
  }
}

export const voiceCloneJob: WorkerJobHandler = {
  name: "voice-clone",
  supports: (job) => job.moduleId === "voice-clone",
  async execute(job, context) {
    if (job.values.operation === "synthesize") return executeSynthesis(job, context);
    const { accounts, store } = context;
    const provenance: StageProvenance[] = [];
    const fail = (error: unknown) => {
      const provider = error instanceof VolcSpeechError ? error : undefined;
      context.change(job.id, {
        status: provider?.code === "VOICE_CLONE_CANCELLED" ? "cancelled" : "failed",
        stage: provider?.code === "VOICE_CLONE_CANCELLED" ? "已取消" : "音色克隆失败",
        provenance,
        error:
          provider?.code === "VOICE_CLONE_CANCELLED"
            ? undefined
            : {
                code: provider?.code ?? "VOICE_CLONE_FAILED",
                message: error instanceof Error ? error.message : "音色克隆失败",
                retryable: provider?.retryable ?? true,
                requestId: provider?.logId ?? crypto.randomUUID(),
              },
      });
    };
    try {
      if (!accounts) throw new Error("素材所有权服务不可用");
      if (!volcSpeech.configured)
        throw new VolcSpeechError("VOLC_SPEECH_NOT_CONFIGURED", "火山引擎语音 API Key 未配置", false);
      if (job.values.authorized !== "true")
        throw new VolcSpeechError("VOICE_CONSENT_REQUIRED", "必须确认已获得录音人授权", false);
      if ((job.values.consentReference?.trim().length ?? 0) < 3)
        throw new VolcSpeechError("VOICE_CONSENT_REFERENCE_REQUIRED", "必须填写可核验的授权记录编号", false);
      const sourceAssetId = job.values.sample?.split(":", 3)[1];
      if (!sourceAssetId) throw new Error("音频素材标识无效");
      const asset = accounts.getOwnedAsset(job.ownerUserId, sourceAssetId);
      if (!asset?.mimeType.startsWith("audio/")) throw new Error("音频素材不存在或不属于当前账号");
      if (asset.byteSize > 10 * 1024 * 1024) throw new Error("训练音频不能超过 10MB");

      const validation: StageProvenance = {
        id: `${job.id}:validate`,
        capability: "audio-validate",
        executionMode: "local",
        implementation: "ffprobe-local",
        startedAt: new Date().toISOString(),
      };
      context.change(job.id, {
        status: "processing",
        stage: "验证录音样本",
        progress: 8,
        executionPlan: [validation],
        provenance: [validation],
        overallExecutionMode: "mixed",
      });

      const tempDir = await mkdtemp(resolve(tmpdir(), "yaozuo-voice-clone-"));
      try {
        const uploadRoot = resolve(env.dataDir, "uploads");
        const localPath = resolve(uploadRoot, asset.storageKey);
        const localRelative = relative(uploadRoot, localPath);
        const samplePath =
          localRelative && !localRelative.startsWith("..") && !localRelative.startsWith("/") && existsSync(localPath)
            ? localPath
            : resolve(tempDir, `sample${extname(asset.originalName) || ".wav"}`);
        if (samplePath !== localPath) {
          if (!ossutils.configured) throw new Error("录音文件不在本机且 TOS 未配置");
          await ossutils.downloadLibraryFile(asset.storageKey, samplePath);
        }
        const media = await probeMedia(samplePath);
        const duration = Number(media.format.duration ?? 0);
        if (!Number.isFinite(duration) || duration < 5 || duration > 60)
          throw new Error("训练录音时长需为 5–60 秒，建议使用 14–30 秒清晰单人声");
        const audioStream = media.streams.find((stream) => stream.codec_type === "audio");
        if (!audioStream) throw new Error("训练文件中没有可识别的音频流");
        const format = formatMap[extname(asset.originalName).toLowerCase()];
        if (!format) throw new Error("仅支持 WAV、MP3、OGG、M4A、AAC 或 PCM 音频");
        const sampleBytes = await Bun.file(samplePath).bytes();
        const sampleHasher = new Bun.CryptoHasher("sha256");
        sampleHasher.update(sampleBytes);
        const sampleSha256 = sampleHasher.digest("hex");
        validation.completedAt = new Date().toISOString();
        provenance.push(validation);

        const speakerId = (job.values.resolvedSpeakerId || "").trim();
        const speaker = { speaker_id: speakerId };
        const resolvedValues = {
          ...job.values,
          resolvedSpeakerId: speakerId,
          sampleSha256,
          sampleDurationSec: duration.toFixed(3),
          sampleChannels: String(audioStream.channels ?? ""),
          sampleRate: String(audioStream.sample_rate ?? ""),
          consentConfirmedAt: job.values.consentConfirmedAt || new Date().toISOString(),
        };
        const training: StageProvenance = {
          id: `${job.id}:train`,
          capability: "voice-clone",
          executionMode: "real",
          implementation: "volc-voice-clone-v3",
          provider: "volcengine",
          model: env.volcSpeech.cloneResourceId,
          startedAt: new Date().toISOString(),
        };
        const resumed = Boolean(job.providerSubmittedAt && job.providerTaskId);
        context.change(job.id, {
          stage: resumed ? "恢复音色训练状态" : "上传样本并训练音色",
          progress: 28,
          values: resolvedValues,
          providerTaskId: speakerId || undefined,
          providerStatus: resumed ? job.providerStatus : "submitting",
          providerSubmittedAt: job.providerSubmittedAt || new Date().toISOString(),
          executionPlan: [validation, training],
          provenance: [...provenance, training],
        });
        const initial = resumed
          ? await volcSpeech.query(speaker)
          : await volcSpeech.train({
              speaker,
              bytes: sampleBytes,
              format,
              transcript: (job.values.transcript ?? "").trim(),
              language: languageMap[job.values.language] ?? 0,
              demoText: (job.values.demoText ?? "").trim() || "你好，这是我的专属克隆音色试听。",
              enableDenoise: job.values.enableDenoise === "true",
            });
        const assignedSpeakerId = initial.speaker_id?.trim() || speakerId;
        const querySpeaker = { speaker_id: assignedSpeakerId };
        if (!querySpeaker.speaker_id) throw new Error("训练接口未返回可查询的音色 ID");
        context.change(job.id, {
          providerTaskId: assignedSpeakerId,
          providerStatus: String(initial.status ?? "training"),
          values: { ...resolvedValues, resolvedSpeakerId: assignedSpeakerId },
        });
        const ready = await volcSpeech.waitUntilReady(querySpeaker, initial, () =>
          Boolean(store.get(job.id)?.cancelRequested),
        );
        training.completedAt = new Date().toISOString();
        provenance.push(training);
        context.change(job.id, { stage: "下载试听结果", progress: 88, provenance: [...provenance] });

        const voiceResult = volcSpeech.resultAudio(ready);
        const demoBytes = await volcSpeech.downloadDemo(voiceResult.demoAudio);
        const audioType = detectAudio(demoBytes);
        const name = `${job.id}-voice-preview.${audioType.extension}`;
        await Bun.write(resolve(env.dataDir, "results", name), demoBytes);
        await probeMedia(resolve(env.dataDir, "results", name));
        const artifactId = crypto.randomUUID();
        accounts.createArtifact({
          id: artifactId,
          ownerUserId: job.ownerUserId,
          jobId: job.id,
          storageKey: name,
          name,
          mimeType: audioType.mimeType,
          createdAt: new Date().toISOString(),
        });
        const result: JobResult = {
          kind: "voice-clone",
          title: job.title,
          summary: "音色克隆完成，已生成可播放的真实试听音频。",
          artifacts: [
            {
              id: artifactId,
              name,
              mimeType: audioType.mimeType,
              url: `/api/artifacts/${artifactId}`,
              executionMode: "real",
              lineage: provenance,
            },
          ],
          data: {
            values: {
              ...resolvedValues,
              resolvedSpeakerId: assignedSpeakerId,
              speakerId: ready.speaker_id || assignedSpeakerId,
              modelType: String(voiceResult.modelType),
              availableTrainingTimes: String(ready.available_training_times ?? ""),
            },
            generatedAt: new Date().toISOString(),
            mock: false,
          },
        };
        context.change(job.id, {
          status: "succeeded",
          stage: "音色克隆完成",
          progress: 100,
          provenance,
          result,
          overallExecutionMode: "real",
          values: result.data?.values ?? job.values,
          providerStatus: "succeeded",
        });
        if (accounts.taskNotificationsEnabled(job.ownerUserId))
          accounts.createNotification(
            job.ownerUserId,
            "task_completed",
            "音色克隆已完成",
            `${job.title} 已可试听。`,
            job.id,
          );
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      fail(error);
    }
  },
};
