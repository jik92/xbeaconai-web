import { resolve } from "node:path";
import { env } from "../../server/env";
import { probeMedia } from "../../server/media/ffmpeg";
import { QwenAudioError, qwenAudio } from "../../server/providers/qwen-audio";
import { ossutils } from "../../server/storage/ossutils";
import type { JobRecord, JobResult, StageProvenance } from "../../server/types";
import { preflightQwenVoiceSample } from "../../server/voice/qwen-voice-sample-preflight";
import { isQwenVoiceDialect, isQwenVoiceSpeed, isQwenVoiceStyle, qwenVoicePrefix } from "../../shared/voice/qwen-voice";
import type { JobHandlerContext, WorkerJobHandler } from "./types";

function failQwenVoiceJob(job: JobRecord, context: JobHandlerContext, error: unknown, provenance: StageProvenance[]) {
  const provider = error instanceof QwenAudioError ? error : undefined;
  const cancelled = context.store.get(job.id)?.cancelRequested;
  context.change(job.id, {
    status: cancelled ? "cancelled" : "failed",
    stage: cancelled ? "已取消" : "Qwen 音色克隆失败",
    provenance,
    providerStatus: cancelled ? job.providerStatus : "failed",
    error: cancelled
      ? undefined
      : {
          code: provider?.code ?? "QWEN_VOICE_CLONE_FAILED",
          message: error instanceof Error ? error.message : "Qwen 音色克隆失败",
          retryable: provider?.retryable ?? true,
          requestId: provider?.requestId ?? crypto.randomUUID(),
        },
  });
}

function assertNotCancelled(job: JobRecord, context: JobHandlerContext) {
  if (context.store.get(job.id)?.cancelRequested)
    throw new QwenAudioError("QWEN_VOICE_CLONE_CANCELLED", "任务已取消", false);
}

export const qwenVoiceCloneJob: WorkerJobHandler = {
  name: "qwen-voice-clone",
  supports: (job) => job.moduleId === "voice-clone" && job.values.voiceProvider === "qwen",
  async execute(job, context) {
    const { accounts } = context;
    const provenance: StageProvenance[] = [];
    try {
      if (!accounts) throw new Error("素材所有权服务不可用");
      if (!qwenAudio.configured)
        throw new QwenAudioError("QWEN_AUDIO_NOT_CONFIGURED", "Qwen Audio 密钥或业务空间未配置", false);
      if (!ossutils.configured) throw new QwenAudioError("QWEN_AUDIO_TOS_REQUIRED", "Qwen 音色克隆需要配置 TOS", false);
      const sourceAssetId = job.values.sample?.split(":", 3)[1];
      if (!sourceAssetId) throw new Error("音频素材标识无效");
      const asset = accounts.getOwnedAsset(job.ownerUserId, sourceAssetId);
      if (!asset?.mimeType.startsWith("audio/")) throw new Error("音频素材不存在或不属于当前账号");
      if (asset.byteSize > 10 * 1024 * 1024) throw new Error("训练音频不能超过 10MB");
      const dialect = job.values.dialect ?? "";
      const style = job.values.style ?? "";
      const speed = job.values.speechSpeed ?? "";
      if (!isQwenVoiceDialect(dialect)) throw new Error("请选择官方支持的合成方言");
      if (!isQwenVoiceStyle(style)) throw new Error("请选择系统提供的配音风格");
      if (!isQwenVoiceSpeed(speed)) throw new Error("请选择系统提供的音色速度");
      const demoText = job.values.demoText?.trim() ?? "";
      if (demoText.length < 4 || demoText.length > 300) throw new Error("音频转换文本需为 4–300 字");

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
      const sampleDuration = (await preflightQwenVoiceSample(job.ownerUserId, sourceAssetId, accounts)).durationSec;
      validation.completedAt = new Date().toISOString();
      provenance.push(validation);

      assertNotCancelled(job, context);
      const enrollment: StageProvenance = {
        id: `${job.id}:enroll`,
        capability: "voice-clone",
        executionMode: "real",
        implementation: "qwen-voice-enrollment",
        provider: "alibaba-cloud",
        model: "voice-enrollment/qwen-audio-3.0-tts-plus",
        startedAt: new Date().toISOString(),
      };
      context.change(job.id, {
        stage: "创建 Qwen 音色人物",
        progress: 30,
        executionPlan: [validation, enrollment],
        provenance: [...provenance, enrollment],
        providerStatus: "submitting",
        providerSubmittedAt: new Date().toISOString(),
      });
      const sourceUrl = ossutils.createSignedReadUrl(asset.storageKey, 60 * 60);
      const prefix = qwenVoicePrefix(job.id);
      const voice = await qwenAudio.createVoice(sourceUrl, prefix);
      enrollment.completedAt = new Date().toISOString();
      provenance.push(enrollment);
      context.change(job.id, {
        stage: "使用新音色生成试听",
        progress: 62,
        providerTaskId: voice.voiceId,
        providerStatus: "enrolled",
        values: {
          ...job.values,
          resolvedSpeakerId: voice.voiceId,
          sampleDurationSec: sampleDuration.toFixed(3),
        },
      });

      assertNotCancelled(job, context);
      const synthesis: StageProvenance = {
        id: `${job.id}:preview`,
        capability: "speech-synthesize",
        executionMode: "real",
        implementation: "qwen-audio-tts",
        provider: "alibaba-cloud",
        model: "qwen-audio-3.0-tts-plus",
        startedAt: new Date().toISOString(),
      };
      const preview = await qwenAudio.synthesize({ voiceId: voice.voiceId, text: demoText, dialect, style, speed });
      const bytes = await qwenAudio.download(preview.audioUrl);
      const name = `${job.id}-qwen-voice-preview.wav`;
      const outputPath = resolve(env.dataDir, "results", name);
      await Bun.write(outputPath, bytes);
      const outputMedia = await probeMedia(outputPath);
      const outputDuration = Number(outputMedia.format.duration ?? 0);
      if (!Number.isFinite(outputDuration) || outputDuration <= 0)
        throw new QwenAudioError("QWEN_AUDIO_INVALID_AUDIO", "Qwen 试听音频无法解码或时长为空", true);
      synthesis.completedAt = new Date().toISOString();
      provenance.push(synthesis);

      const artifactId = crypto.randomUUID();
      let artifactUrl: string;
      let outputFolderId = "";
      if (job.values.outputFolderId) {
        const folder = accounts.getAssetFolder(job.ownerUserId, job.values.outputFolderId ?? "");
        if (!folder) throw new Error("任务保存文件夹不存在");
        const storageKey = `${folder.storagePrefix}generated/${job.id}/${name}`;
        context.change(job.id, { stage: "正在自动保存到素材库", progress: 92 });
        await ossutils.putLibraryBytes({ bytes, key: storageKey, mimeType: "audio/wav" });
        accounts.createAsset({
          id: artifactId,
          ownerUserId: job.ownerUserId,
          storageKey,
          originalName: name,
          mimeType: "audio/wav",
          byteSize: bytes.byteLength,
          durationSec: outputDuration,
          kind: "media",
          displayName: job.title,
          description: `由 Qwen 音色人物任务 ${job.id} 创建`,
          folderId: folder.id,
          createdAt: new Date().toISOString(),
        });
        artifactUrl = `/api/assets/${artifactId}/access`;
        outputFolderId = folder.id;
      } else {
        accounts.createArtifact({
          id: artifactId,
          ownerUserId: job.ownerUserId,
          jobId: job.id,
          storageKey: name,
          name,
          mimeType: "audio/wav",
          createdAt: new Date().toISOString(),
        });
        artifactUrl = `/api/artifacts/${artifactId}/access`;
      }
      const values = {
        ...job.values,
        resolvedSpeakerId: voice.voiceId,
        providerRequestId: preview.requestId || voice.requestId || "",
        sampleDurationSec: sampleDuration.toFixed(3),
        outputDurationSec: outputDuration.toFixed(3),
        outputFolderId,
      };
      const result: JobResult = {
        kind: "voice-clone",
        title: job.title,
        summary:
          job.values.autoSave === "true"
            ? `Qwen 音色人物创建完成，${dialect}试听音频已保存到素材库。`
            : `Qwen 音色人物创建完成，已生成${dialect}试听音频。`,
        artifacts: [
          {
            id: artifactId,
            name,
            mimeType: "audio/wav",
            url: artifactUrl,
            executionMode: "real",
            lineage: provenance,
          },
        ],
        data: { values, generatedAt: new Date().toISOString(), mock: false },
      };
      context.change(job.id, {
        status: "succeeded",
        stage: "Qwen 音色人物创建完成",
        progress: 100,
        provenance,
        result,
        values,
        overallExecutionMode: "real",
        providerStatus: "succeeded",
      });
      if (accounts.taskNotificationsEnabled(job.ownerUserId))
        accounts.createNotification(
          job.ownerUserId,
          "task_completed",
          "Qwen 音色创建完成",
          `${job.title} 已可试听。`,
          job.id,
        );
    } catch (error) {
      failQwenVoiceJob(job, context, error, provenance);
    }
  },
};
