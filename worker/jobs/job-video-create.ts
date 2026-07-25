import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { providerCredentials } from "../../server/byok/credential-store";
import { env } from "../../server/env";
import {
  burnSubtitleFile,
  composeMedia,
  concatVideos,
  generateSampleAudio,
  generateSampleVideo,
  probeMedia,
} from "../../server/media/ffmpeg";
import { isSeedanceModelId } from "../../server/models/video-models";
import { resolvePortraitReference } from "../../server/portraits/portrait-resolver";
import { arkSeedance } from "../../server/providers/ark-seedance";
import { volcSpeech } from "../../server/providers/volc-speech";
import { ossutils } from "../../server/storage/ossutils";
import type { JobRecord, StageProvenance } from "../../server/types";
import {
  analyzeVideoCreateProduct,
  generateVideoCreateScript,
  generateVideoCreateStoryboard,
  regenerateVideoCreateSection,
} from "../../server/video-create/model";
import type { VideoCreateSubtitleCue } from "../../server/video-create/types";
import { VIDEO_CREATE_ANALYSIS_MODEL } from "../../server/video-create/types";
import {
  type MaterialVersionRow,
  videoCreateError,
  videoCreateShotNarration,
} from "../../server/video-create/video-create-store";
import { normalizePortraitReference } from "../../shared/portraits/portrait-reference";
import {
  getVideoCreateSubtitlePreset,
  type VideoCreateSubtitleStyleId,
  type VideoCreateVoiceSettings,
  videoCreateVoiceContextText,
  videoCreateVoiceSpeechRate,
} from "../../shared/video-create/media-settings";
import { SeedanceFlowError, SeedanceVideoJob, seedanceVideoSettings } from "./job-seedance-video";
import type { JobHandlerContext, WorkerJobHandler } from "./types";

function stage(
  job: JobRecord,
  capability: string,
  executionMode: "real" | "local" | "mock",
  implementation: string,
  model?: string,
): StageProvenance {
  return {
    id: `${job.id}:${capability}`,
    capability,
    executionMode,
    implementation,
    provider:
      executionMode !== "real"
        ? undefined
        : implementation.startsWith("ark-seedance-")
          ? "ark"
          : implementation === "volc-tts-v3-unidirectional"
            ? "volc-speech"
            : "aihubmix",
    model: executionMode === "real" ? model : undefined,
    startedAt: new Date().toISOString(),
  };
}

function artifactResult(
  job: JobRecord,
  artifact?: { id: string; name: string; mimeType: string; executionMode: "real" | "local" | "mock" },
  lineage: StageProvenance[] = [],
) {
  return {
    kind: "video-create",
    title: job.title,
    summary: artifact ? "一键成片阶段产物已生成" : "一键成片文本阶段已完成",
    artifacts: artifact ? [{ ...artifact, url: `/api/artifacts/${artifact.id}`, lineage }] : [],
    data: { values: job.values, generatedAt: new Date().toISOString(), mock: artifact?.executionMode === "mock" },
  };
}

async function saveVideoArtifact(
  job: JobRecord,
  context: JobHandlerContext,
  bytes: Uint8Array | undefined,
  sourcePath: string | undefined,
  executionMode: "real" | "local" | "mock",
  subtitleCues?: VideoCreateSubtitleCue[],
  subtitleStyleId?: VideoCreateSubtitleStyleId,
  sampleDurationSec = 4,
  nameSuffix = "",
) {
  const name = `${job.id}${nameSuffix}-video-create.mp4`;
  const output = resolve(env.dataDir, "results", name);
  const sourceOutput = subtitleCues?.length
    ? resolve(env.dataDir, "results", `${job.id}-video-create-source.mp4`)
    : output;
  const temporaryFiles = subtitleCues?.length ? [sourceOutput] : [];
  try {
    if (bytes) await Bun.write(sourceOutput, bytes);
    else if (sourcePath) await Bun.write(sourceOutput, Bun.file(sourcePath));
    else await generateSampleVideo(sourceOutput, sampleDurationSec);
    if (subtitleCues?.length) {
      const subtitlePath = resolve(env.dataDir, "results", `${job.id}-video-create.srt`);
      temporaryFiles.push(subtitlePath);
      await Bun.write(subtitlePath, cuesToSrt(subtitleCues));
      await burnSubtitleFile(
        sourceOutput,
        subtitlePath,
        output,
        getVideoCreateSubtitlePreset(subtitleStyleId).forceStyle,
      );
    }
  } finally {
    await Promise.all(temporaryFiles.map((file) => unlink(file).catch(() => undefined)));
  }
  const metadata = await probeMedia(output);
  const durationSec = Number(
    metadata.format.duration ?? metadata.streams.find((item) => item.codec_type === "video")?.duration,
  );
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error("VIDEO_CREATE_VIDEO_DURATION_INVALID");
  const id = crypto.randomUUID();
  context.accounts?.createArtifact({
    id,
    ownerUserId: job.ownerUserId,
    jobId: job.id,
    storageKey: name,
    name,
    mimeType: "video/mp4",
    createdAt: new Date().toISOString(),
  });
  return { id, name, mimeType: "video/mp4", executionMode, durationSec } as const;
}

export function findLegacyArkSourceJob(
  lineage: Array<Pick<MaterialVersionRow, "jobId">>,
  getJob: (jobId: string) => JobRecord | undefined,
) {
  for (const version of lineage) {
    if (!version.jobId) continue;
    const sourceJob = getJob(version.jobId);
    if (
      sourceJob?.providerTaskId &&
      (sourceJob.executionPlan.some(
        (item) => item.provider === "ark" || item.implementation === "ark-seedance-video",
      ) ||
        (sourceJob.providerModel && isSeedanceModelId(sourceJob.providerModel)))
    )
      return sourceJob;
  }
  return undefined;
}

export function videoCreateSubtitleAudioArtifactId(shot: { audioEnabled: boolean; audioArtifactId?: string | null }) {
  return shot.audioEnabled ? (shot.audioArtifactId ?? undefined) : undefined;
}

async function recoverLegacySubtitleSource(
  job: JobRecord,
  context: JobHandlerContext,
  projectId: string,
  shotId: string,
  versionId: string,
) {
  const projects = context.videoCreates;
  if (!projects) throw new Error("VIDEO_CREATE_STORE_UNAVAILABLE");
  const lineage = projects.getMaterialVersionLineage(projectId, shotId, versionId);
  const sourceJob = findLegacyArkSourceJob(lineage, (jobId) => context.store.get(jobId));
  if (!sourceJob?.providerTaskId)
    throw new SeedanceFlowError(
      "LEGACY_SUBTITLE_SOURCE_EXPIRED",
      "旧素材没有可恢复的无字幕母版，请重新生成分镜视频",
      false,
    );
  try {
    const task = await arkSeedance.getVideo(sourceJob.providerTaskId);
    if (task.status !== "succeeded" || !task.content?.video_url) throw new Error("ARK_VIDEO_URL_MISSING");
    const response = await arkSeedance.downloadVideo(task.content.video_url);
    const artifact = await saveVideoArtifact(
      job,
      context,
      response.bytes,
      undefined,
      "real",
      undefined,
      undefined,
      undefined,
      "-recovered-source",
    );
    const originVersion = lineage.find((version) => version.jobId === sourceJob.id);
    const version = projects.createMaterialVersion({
      projectId,
      shotId,
      source: "ai_generated",
      storageKind: "artifact",
      contentId: artifact.id,
      inputVersionId: originVersion?.inputVersionId,
      subtitlesComposed: false,
      subtitleStyleId: null,
    });
    return { version, path: resolve(env.dataDir, "results", artifact.name), sourceJob };
  } catch (error) {
    if (error instanceof SeedanceFlowError) throw error;
    throw new SeedanceFlowError(
      "LEGACY_SUBTITLE_SOURCE_EXPIRED",
      "旧素材的无字幕母版已过期，请重新生成分镜视频",
      false,
    );
  }
}

export function buildSubtitleCues(text: string, durationSec: number): VideoCreateSubtitleCue[] {
  const phrases =
    text
      .split(/(?<=[，。！？；,.!?;])/u)
      .map((item) => item.trim())
      .filter(Boolean) || [];
  const normalized = phrases.length ? phrases : [text.trim()].filter(Boolean);
  const totalWeight = normalized.reduce((total, phrase) => total + Math.max([...phrase].length, 1), 0);
  let cursor = 0;
  return normalized.map((phrase, index) => {
    const startSec = Number(cursor.toFixed(2));
    cursor =
      index === normalized.length - 1
        ? durationSec
        : cursor + durationSec * (Math.max([...phrase].length, 1) / totalWeight);
    return {
      startSec,
      endSec: Number(Math.min(durationSec, Math.max(cursor, startSec + 0.01)).toFixed(2)),
      text: phrase,
    };
  });
}

export function resolveVideoCreateSubtitleDuration(input: {
  videoDurationSec: number;
  audioDurationSec: number;
  generatedWithAudio: boolean;
}) {
  if (!input.generatedWithAudio && input.audioDurationSec - input.videoDurationSec > 1)
    throw new SeedanceFlowError(
      "VIDEO_AUDIO_DURATION_MISMATCH",
      `配音时长 ${input.audioDurationSec.toFixed(3)} 秒超过视频时长 ${input.videoDurationSec.toFixed(3)} 秒，请重新生成视频`,
      true,
    );
  return input.generatedWithAudio ? input.videoDurationSec : Math.min(input.audioDurationSec, input.videoDurationSec);
}

export function resolveVideoCreateShotGenerationSettings(
  values: Record<string, string>,
  shot: { audioEnabled: boolean; subtitleEnabled: boolean },
) {
  return {
    generatedWithAudio: values.generateAudio === undefined ? !shot.audioEnabled : values.generateAudio === "true",
    subtitleEnabled: values.subtitleEnabled === undefined ? shot.subtitleEnabled : values.subtitleEnabled === "true",
  };
}

function srtTimestamp(seconds: number) {
  const milliseconds = Math.max(0, Math.round(seconds * 1_000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function cuesToSrt(cues: VideoCreateSubtitleCue[]) {
  return cues
    .map((cue, index) => `${index + 1}\n${srtTimestamp(cue.startSec)} --> ${srtTimestamp(cue.endSec)}\n${cue.text}\n`)
    .join("\n");
}

function voiceSettingsFromJob(job: JobRecord): VideoCreateVoiceSettings {
  return {
    presetVoiceId: job.values.voicePresetId as VideoCreateVoiceSettings["presetVoiceId"],
    speed: job.values.voiceSpeed as VideoCreateVoiceSettings["speed"],
    style: job.values.voiceStyle as VideoCreateVoiceSettings["style"],
  };
}

async function saveShotAudio(job: JobRecord, context: JobHandlerContext, shotId: string, text: string, mock: boolean) {
  if (!context.accounts) throw new Error("ACCOUNT_STORE_UNAVAILABLE");
  const settings = voiceSettingsFromJob(job);
  const name = `${job.id}-${shotId}-voice.${mock ? "wav" : "mp3"}`;
  const output = resolve(env.dataDir, "results", name);
  const response = mock
    ? undefined
    : await volcSpeech.synthesize({
        requestId: crypto.randomUUID(),
        resourceId: env.volcSpeech.presetTtsResourceId,
        speaker: settings.presetVoiceId,
        text,
        model: "seed-tts-2.0-expressive",
        speechRate: videoCreateVoiceSpeechRate(settings.speed),
        explicitLanguage: "zh",
        contextText: videoCreateVoiceContextText(settings.style),
        toneFidelity: false,
      });
  if (response) await Bun.write(output, response.bytes);
  else await generateSampleAudio(output);
  const metadata = await probeMedia(output);
  const durationSec = Number(
    metadata.format.duration ?? metadata.streams.find((item) => item.codec_type === "audio")?.duration,
  );
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error("VIDEO_CREATE_AUDIO_DURATION_INVALID");
  const id = crypto.randomUUID();
  context.accounts.createArtifact({
    id,
    ownerUserId: job.ownerUserId,
    jobId: job.id,
    storageKey: name,
    name,
    mimeType: response ? "audio/mpeg" : "audio/wav",
    createdAt: new Date().toISOString(),
  });
  return { id, path: output, durationSec };
}

export const videoCreateJob: WorkerJobHandler = {
  name: "video-create",
  supports: (job) => job.moduleId === "video-create",
  async execute(job, context) {
    const projects = context.videoCreates;
    const projectId = job.values.projectId;
    const operation = job.values.operation;
    if (!projects || !projectId) throw new Error("VIDEO_CREATE_STORE_UNAVAILABLE");
    const aggregate = projects.get(projectId);
    if (!aggregate || aggregate.project.ownerUserId !== job.ownerUserId)
      throw new Error("VIDEO_CREATE_PROJECT_NOT_FOUND");
    const usesMockVideo = operation === "shot" && (job.values.__mockVideo === "true" || env.mockGenerateVideoApi);
    const localOperation = operation === "compose" || operation === "audio-replace" || operation === "subtitle-compose";
    const mode = usesMockVideo ? "mock" : localOperation ? "local" : "real";
    const implementation =
      mode === "mock"
        ? env.mockGenerateVideoApi && job.values.__mockVideo !== "true"
          ? "ffmpeg-seedance-mock"
          : "video-create-test-mock"
        : mode === "local"
          ? operation === "audio-replace"
            ? "ffmpeg-audio-replace"
            : operation === "subtitle-compose"
              ? "ffmpeg-subtitle"
              : "ffmpeg-concat"
          : operation === "analyze"
            ? "aihubmix-gpt-image-analysis"
            : operation === "shot"
              ? "ark-seedance-video"
              : operation === "audio-generate"
                ? "volc-tts-v3-unidirectional"
                : "aihubmix-text";
    const model = localOperation
      ? undefined
      : operation === "analyze"
        ? VIDEO_CREATE_ANALYSIS_MODEL
        : operation === "shot"
          ? job.videoModel
          : operation === "audio-generate"
            ? env.volcSpeech.presetTtsResourceId
            : "deepseek-v4-pro";
    const currentStage = stage(job, operation, mode, implementation, model);
    context.change(job.id, {
      status: "processing",
      stage:
        operation === "analyze"
          ? "AI 填充参数"
          : operation === "script"
            ? "生成脚本"
            : operation === "storyboard"
              ? "生成分镜"
              : operation === "shot"
                ? "生成分镜视频"
                : operation === "audio-generate"
                  ? "生成配音"
                  : operation === "audio-replace"
                    ? "替换配音"
                    : operation === "subtitle-compose"
                      ? "合成字幕"
                      : operation === "compose"
                        ? "合并视频"
                        : "换一版",
      progress: 10,
      provenance: [currentStage],
      overallExecutionMode: mode,
    });
    try {
      if (operation === "analyze") {
        if (!context.accounts) throw new Error("ACCOUNT_STORE_UNAVAILABLE");
        const assets = aggregate.project.input.productAssetIds.map((id) =>
          context.accounts?.getOwnedAsset(job.ownerUserId, id),
        );
        if (assets.some((asset) => !asset?.mimeType.startsWith("image/")))
          throw new Error("PRODUCT_IMAGE_NOT_AVAILABLE");
        const portraitReference = normalizePortraitReference(
          aggregate.project.input.portraitReference,
          aggregate.project.input.portraitId,
        );
        if (portraitReference && !context.customPortraits) throw new Error("PORTRAIT_STORE_UNAVAILABLE");
        const portrait =
          portraitReference && context.customPortraits
            ? resolvePortraitReference({
                ownerUserId: job.ownerUserId,
                reference: portraitReference,
                accounts: context.accounts,
                customPortraits: context.customPortraits,
              })
            : undefined;
        if (portraitReference && !portrait) throw new Error("PORTRAIT_NOT_AVAILABLE");
        const portraitAnalysisInput = portrait
          ? {
              name: portrait.name,
              source_url:
                portraitReference?.type === "custom"
                  ? ossutils.createSignedReadUrl(
                      context.accounts.getOwnedAsset(job.ownerUserId, portraitReference.assetId)!.storageKey,
                    )
                  : portrait.imageUrl,
            }
          : undefined;
        const recommendation = await analyzeVideoCreateProduct(
          assets.filter((asset): asset is NonNullable<typeof asset> => Boolean(asset)),
          portraitAnalysisInput,
        );
        projects.setRecommendation(projectId, recommendation);
      } else if (operation === "script") {
        const generated = await generateVideoCreateScript(aggregate);
        projects.replaceScripts(projectId, generated);
      } else if (operation === "regenerate-section") {
        const sectionId = job.values.sectionId;
        const expectedVersionId = job.values.expectedVersionId;
        if (!sectionId || !expectedVersionId) throw new Error("SCRIPT_VERSION_REQUIRED");
        const generated = await regenerateVideoCreateSection(aggregate, sectionId);
        projects.appendScriptVersion({
          projectId,
          sectionId,
          expectedVersionId,
          text: generated.text,
          durationSec: generated.durationSec,
          source: "regenerated",
        });
        projects.setProject(projectId, { status: "script_review" });
      } else if (operation === "storyboard") {
        const portraitReference = normalizePortraitReference(
          aggregate.project.input.portraitReference,
          aggregate.project.input.portraitId,
        );
        const portrait =
          portraitReference && context.accounts && context.customPortraits
            ? resolvePortraitReference({
                ownerUserId: job.ownerUserId,
                reference: portraitReference,
                accounts: context.accounts,
                customPortraits: context.customPortraits,
              })
            : undefined;
        const generated = await generateVideoCreateStoryboard(aggregate, portrait?.name);
        projects.replaceShots(projectId, generated);
      } else if (operation === "audio-generate") {
        const shotId = job.values.shotId;
        const shot = aggregate.shots.find((item) => item.id === shotId);
        if (!shot) throw new Error("SHOT_NOT_FOUND");
        projects.updateShot(shot.id, { status: "generating", jobId: job.id, error: null });
        const narration = videoCreateShotNarration(aggregate, shot);
        if (!narration) throw new Error("SHOT_SCRIPT_NOT_AVAILABLE");
        const audio = await saveShotAudio(job, context, shot.id, narration, job.values.__mockAudio === "true");
        projects.updateShot(shot.id, {
          audioArtifactId: audio.id,
          audioSettingsKey: job.values.voiceSettingsKey,
          status: (job.values.previousShotStatus as typeof shot.status) ?? "pending",
          error: null,
        });
        projects.setProject(projectId, { status: "storyboard_review", error: null });
        currentStage.completedAt = new Date().toISOString();
        context.change(job.id, {
          status: "succeeded",
          stage: "已完成",
          progress: 100,
          provenance: [currentStage],
          overallExecutionMode: job.values.__mockAudio === "true" ? "mock" : "real",
          result: artifactResult(job, undefined, [currentStage]),
        });
        return;
      } else if (operation === "shot") {
        const shotId = job.values.shotId;
        const shot = aggregate.shots.find((item) => item.id === shotId);
        if (!shot) throw new Error("SHOT_NOT_FOUND");
        projects.updateShot(shot.id, {
          ...(!shot.currentMaterialVersionId ? { status: "generating" as const } : {}),
          jobId: job.id,
          attempts: shot.attempts + 1,
          error: null,
        });
        const narration = videoCreateShotNarration(aggregate, shot);
        if (!narration) throw new Error("SHOT_SCRIPT_NOT_AVAILABLE");
        const mockAudio = job.values.__mockAudio === "true";
        const { generatedWithAudio, subtitleEnabled } = resolveVideoCreateShotGenerationSettings(job.values, shot);
        const shouldGenerateAudio =
          mockAudio || (!generatedWithAudio && providerCredentials.isProviderVerified("volc-speech"));
        const audioStage = shouldGenerateAudio
          ? stage(
              job,
              "speech-synthesis",
              mockAudio ? "mock" : "real",
              mockAudio ? "video-create-test-mock-audio" : "volc-tts-v3-unidirectional",
              env.volcSpeech.presetTtsResourceId,
            )
          : undefined;
        const audio = shouldGenerateAudio
          ? await saveShotAudio(job, context, shot.id, narration, mockAudio)
          : undefined;
        if (audioStage) audioStage.completedAt = new Date().toISOString();
        const subtitleStage = subtitleEnabled ? stage(job, "subtitle-compose", "local", "ffmpeg-subtitle") : undefined;
        let artifact: Awaited<ReturnType<typeof saveVideoArtifact>>;
        let videoDurationSec: number;
        let sourceBytes: Uint8Array | undefined;
        let sourceExecutionMode: "real" | "local" | "mock";
        if (job.values.__mockVideo === "true") {
          videoDurationSec = seedanceVideoSettings(job.values).duration;
          sourceExecutionMode = "mock";
        } else {
          if (!job.videoModel || !isSeedanceModelId(job.videoModel)) throw new Error("VIDEO_MODEL_REQUIRED");
          const response = await new SeedanceVideoJob(context).execute(job, job.videoModel);
          videoDurationSec = response.durationSec;
          sourceBytes = response.bytes;
          sourceExecutionMode = response.executionMode;
          currentStage.executionMode = response.executionMode;
          currentStage.implementation = response.implementation;
          currentStage.provider = response.executionMode === "real" ? "ark" : undefined;
          currentStage.model = response.executionMode === "real" ? job.videoModel : undefined;
        }
        const subtitleDurationSec = resolveVideoCreateSubtitleDuration({
          videoDurationSec,
          audioDurationSec: audio?.durationSec ?? videoDurationSec,
          generatedWithAudio: generatedWithAudio || !audio,
        });
        const subtitleCues = buildSubtitleCues(narration, subtitleDurationSec);
        let cleanVersionId: string | undefined;
        if (subtitleEnabled) {
          const cleanArtifact = await saveVideoArtifact(
            job,
            context,
            sourceBytes,
            undefined,
            sourceExecutionMode,
            undefined,
            undefined,
            videoDurationSec,
            "-source",
          );
          const cleanVersion = projects.createAndApplyMaterialVersion({
            projectId,
            shotId: shot.id,
            source: "ai_generated",
            storageKind: "artifact",
            contentId: cleanArtifact.id,
            inputVersionId: shot.currentMaterialVersionId,
            status: "succeeded",
            subtitlesComposed: false,
            subtitleStyleId: null,
          });
          cleanVersionId = cleanVersion.id;
          artifact = await saveVideoArtifact(
            job,
            context,
            undefined,
            resolve(env.dataDir, "results", cleanArtifact.name),
            sourceExecutionMode,
            subtitleCues,
            job.values.subtitleStyleId as VideoCreateSubtitleStyleId,
            videoDurationSec,
          );
        } else
          artifact = await saveVideoArtifact(
            job,
            context,
            sourceBytes,
            undefined,
            sourceExecutionMode,
            undefined,
            undefined,
            videoDurationSec,
          );
        projects.updateShot(shot.id, { subtitleCues });
        if (subtitleStage) subtitleStage.completedAt = new Date().toISOString();
        if (projects.getMaterialVersionByJobId(job.id))
          projects.completePendingMaterialVersion({
            jobId: job.id,
            storageKind: "artifact",
            contentId: artifact.id,
            subtitlesComposed: subtitleEnabled,
            subtitleStyleId: subtitleEnabled ? (job.values.subtitleStyleId as VideoCreateSubtitleStyleId) : null,
            inputVersionId: cleanVersionId,
          });
        else
          projects.createAndApplyMaterialVersion({
            projectId,
            shotId: shot.id,
            source: "ai_generated",
            storageKind: "artifact",
            contentId: artifact.id,
            inputVersionId: cleanVersionId ?? shot.currentMaterialVersionId,
            jobId: job.id,
            subtitlesComposed: subtitleEnabled,
            subtitleStyleId: subtitleEnabled ? (job.values.subtitleStyleId as VideoCreateSubtitleStyleId) : null,
          });
        projects.updateShot(shot.id, {
          ...(audio ? { audioArtifactId: audio.id, audioSettingsKey: job.values.voiceSettingsKey } : {}),
          audioEnabled: !generatedWithAudio,
          error: null,
        });
        projects.setProject(projectId, { status: "storyboard_review", error: null });
        currentStage.completedAt = new Date().toISOString();
        context.change(job.id, {
          status: "succeeded",
          stage: "已完成",
          progress: 100,
          provenance: [...(audioStage ? [audioStage] : []), currentStage, ...(subtitleStage ? [subtitleStage] : [])],
          overallExecutionMode:
            subtitleStage || (audioStage && artifact.executionMode !== audioStage.executionMode)
              ? "mixed"
              : artifact.executionMode,
          result: artifactResult(job, artifact, [
            ...(audioStage ? [audioStage] : []),
            currentStage,
            ...(subtitleStage ? [subtitleStage] : []),
          ]),
        });
        return;
      } else if (operation === "audio-replace" || operation === "subtitle-compose") {
        if (!context.accounts) throw new Error("ACCOUNT_STORE_UNAVAILABLE");
        const shotId = job.values.shotId;
        const shot = aggregate.shots.find((item) => item.id === shotId);
        const inputVersionId = job.values.inputMaterialVersionId;
        if (!shot || !inputVersionId) throw new Error("SHOT_MATERIAL_VERSION_REQUIRED");
        if (shot.currentMaterialVersionId !== (job.values.expectedCurrentMaterialVersionId ?? inputVersionId))
          throw new Error("SHOT_MATERIAL_VERSION_CHANGED");
        const initialVersion = projects.getMaterialVersion(projectId, shot.id, inputVersionId);
        if (!initialVersion?.contentId || !initialVersion.storageKind || initialVersion.status !== "succeeded")
          throw new Error("SHOT_VIDEO_NOT_AVAILABLE");
        let version: MaterialVersionRow = initialVersion;
        let recoveredPath: string | undefined;
        let recoveryStage: StageProvenance | undefined;
        if (operation === "subtitle-compose" && version.subtitlesComposed) {
          if (version.subtitleStyleId && version.subtitleStyleId === job.values.subtitleStyleId)
            throw new SeedanceFlowError("SUBTITLES_ALREADY_COMPOSED", "当前视频已合成字幕，请勿重复合成", false);
          const recovered = await recoverLegacySubtitleSource(job, context, projectId, shot.id, version.id);
          version = recovered.version;
          recoveredPath = recovered.path;
          recoveryStage = stage(
            job,
            "source-recovery",
            "real",
            "ark-seedance-source-recovery",
            recovered.sourceJob.providerModel,
          );
          recoveryStage.completedAt = new Date().toISOString();
        }
        const inputPath =
          recoveredPath ??
          (version.storageKind === "artifact"
            ? (() => {
                const artifact = context.accounts?.getArtifact(job.ownerUserId, version.contentId ?? "");
                if (!artifact) throw new Error("SHOT_VIDEO_NOT_AVAILABLE");
                return resolve(env.dataDir, "results", artifact.storage_key);
              })()
            : (() => {
                const asset = context.accounts?.getOwnedAsset(job.ownerUserId, version.contentId ?? "");
                if (!asset?.mimeType.startsWith("video/")) throw new Error("SHOT_VIDEO_NOT_AVAILABLE");
                return resolve(env.dataDir, "uploads", asset.storageKey);
              })());
        const temporaryFiles: string[] = [];
        try {
          const output = resolve(env.dataDir, "results", `${job.id}-${operation}.mp4`);
          if (operation === "audio-replace") {
            if (!shot.audioArtifactId) throw new Error("SHOT_AUDIO_NOT_AVAILABLE");
            const audio = context.accounts.getArtifact(job.ownerUserId, shot.audioArtifactId);
            if (!audio) throw new Error("SHOT_AUDIO_NOT_AVAILABLE");
            await composeMedia(inputPath, resolve(env.dataDir, "results", audio.storage_key), output);
          } else {
            if (!shot.subtitleCues.length) throw new Error("SHOT_SUBTITLE_NOT_AVAILABLE");
            const subtitlePath = resolve(env.dataDir, "results", `${job.id}.srt`);
            await Bun.write(subtitlePath, cuesToSrt(shot.subtitleCues));
            temporaryFiles.push(subtitlePath);
            let subtitleInputPath = inputPath;
            const subtitleAudioArtifactId = videoCreateSubtitleAudioArtifactId(shot);
            if (subtitleAudioArtifactId) {
              const audio = context.accounts.getArtifact(job.ownerUserId, subtitleAudioArtifactId);
              if (!audio) throw new Error("SHOT_AUDIO_NOT_AVAILABLE");
              const audioOutput = resolve(env.dataDir, "results", `${job.id}-subtitle-audio.mp4`);
              await composeMedia(inputPath, resolve(env.dataDir, "results", audio.storage_key), audioOutput);
              subtitleInputPath = audioOutput;
              temporaryFiles.push(audioOutput);
            }
            await burnSubtitleFile(
              subtitleInputPath,
              subtitlePath,
              output,
              getVideoCreateSubtitlePreset(job.values.subtitleStyleId as VideoCreateSubtitleStyleId).forceStyle,
            );
          }
          temporaryFiles.push(output);
          const artifact = await saveVideoArtifact(job, context, undefined, output, "local");
          projects.completePendingMaterialVersion({
            jobId: job.id,
            storageKind: "artifact",
            contentId: artifact.id,
            subtitlesComposed: operation === "subtitle-compose" ? true : version.subtitlesComposed,
            subtitleStyleId:
              operation === "subtitle-compose"
                ? (job.values.subtitleStyleId as VideoCreateSubtitleStyleId)
                : version.subtitleStyleId,
            inputVersionId: operation === "subtitle-compose" ? version.id : undefined,
          });
          projects.setProject(projectId, { status: "storyboard_review", error: null });
          currentStage.completedAt = new Date().toISOString();
          context.change(job.id, {
            status: "succeeded",
            stage: "已完成",
            progress: 100,
            provenance: [...(recoveryStage ? [recoveryStage] : []), currentStage],
            overallExecutionMode: recoveryStage ? "mixed" : "local",
            result: artifactResult(job, artifact, [...(recoveryStage ? [recoveryStage] : []), currentStage]),
          });
          return;
        } finally {
          await Promise.all(temporaryFiles.map((file) => unlink(file).catch(() => undefined)));
        }
      } else if (operation === "compose") {
        if (!aggregate.canCompose) throw new Error("SHOTS_NOT_READY");
        let artifact: Awaited<ReturnType<typeof saveVideoArtifact>>;
        if (job.values.__mockVideo === "true")
          artifact = await saveVideoArtifact(job, context, undefined, undefined, "mock");
        else {
          if (!context.accounts) throw new Error("ACCOUNT_STORE_UNAVAILABLE");
          const inputs = aggregate.shots.map((shot) => {
            if (!shot.videoAssetId) throw new Error("SHOT_VIDEO_NOT_AVAILABLE");
            const generated = context.accounts?.getArtifact(job.ownerUserId, shot.videoAssetId);
            if (generated) return resolve(env.dataDir, "results", generated.storage_key);
            const replacement = context.accounts?.getOwnedAsset(job.ownerUserId, shot.videoAssetId);
            if (!replacement) throw new Error("SHOT_VIDEO_NOT_AVAILABLE");
            return resolve(env.dataDir, "uploads", replacement.storageKey);
          });
          const preparedInputs: string[] = [];
          const temporaryFiles: string[] = [];
          try {
            for (const [index, shot] of aggregate.shots.entries()) {
              let prepared = inputs[index];
              if (!prepared) throw new Error("SHOT_VIDEO_NOT_AVAILABLE");
              const currentMaterialVersion = shot.currentMaterialVersionId
                ? projects.getMaterialVersion(projectId, shot.id, shot.currentMaterialVersionId)
                : undefined;
              if (shot.audioEnabled && shot.audioArtifactId) {
                const audio = context.accounts.getArtifact(job.ownerUserId, shot.audioArtifactId);
                if (!audio) throw new Error("SHOT_AUDIO_NOT_AVAILABLE");
                const audioOutput = resolve(env.dataDir, "results", `${job.id}-shot-${shot.ordinal}-audio.mp4`);
                await composeMedia(prepared, resolve(env.dataDir, "results", audio.storage_key), audioOutput);
                prepared = audioOutput;
                temporaryFiles.push(audioOutput);
              }
              if (shot.subtitleEnabled && shot.subtitleCues.length && !currentMaterialVersion?.subtitlesComposed) {
                const subtitlePath = resolve(env.dataDir, "results", `${job.id}-shot-${shot.ordinal}.srt`);
                const subtitleOutput = resolve(env.dataDir, "results", `${job.id}-shot-${shot.ordinal}-subtitle.mp4`);
                await Bun.write(subtitlePath, cuesToSrt(shot.subtitleCues));
                temporaryFiles.push(subtitlePath);
                await burnSubtitleFile(
                  prepared,
                  subtitlePath,
                  subtitleOutput,
                  getVideoCreateSubtitlePreset(aggregate.project.input.subtitleStyleId).forceStyle,
                );
                prepared = subtitleOutput;
                temporaryFiles.push(subtitleOutput);
              }
              preparedInputs.push(prepared);
            }
            const output = resolve(env.dataDir, "results", `${job.id}-compose-source.mp4`);
            if (preparedInputs.length === 1) await Bun.write(output, Bun.file(preparedInputs[0]));
            else await concatVideos(preparedInputs, output);
            artifact = await saveVideoArtifact(job, context, undefined, output, "local");
          } finally {
            await Promise.all(temporaryFiles.map((file) => unlink(file).catch(() => undefined)));
          }
        }
        projects.setProject(projectId, { status: "completed", finalArtifactId: artifact.id, error: null });
        currentStage.completedAt = new Date().toISOString();
        context.change(job.id, {
          status: "succeeded",
          stage: "已完成",
          progress: 100,
          provenance: [currentStage],
          result: artifactResult(job, artifact, [currentStage]),
        });
        return;
      } else throw new Error("VIDEO_CREATE_OPERATION_UNSUPPORTED");
      currentStage.completedAt = new Date().toISOString();
      context.change(job.id, {
        status: "succeeded",
        stage: "已完成",
        progress: 100,
        provenance: [currentStage],
        result: artifactResult(job, undefined, [currentStage]),
      });
    } catch (error) {
      const apiError = videoCreateError(error);
      const shotId = job.values.shotId;
      if (shotId) {
        const previousShotStatus = job.values.previousShotStatus as
          | "pending"
          | "succeeded"
          | "failed"
          | "replaced"
          | undefined;
        if (projects.getMaterialVersionByJobId(job.id))
          projects.failPendingMaterialVersion(
            job.id,
            apiError,
            operation === "shot" && !job.values.inputMaterialVersionId ? "failed" : previousShotStatus,
          );
        else
          projects.updateShot(shotId, {
            status: operation === "audio-generate" ? (previousShotStatus ?? "pending") : "failed",
            error: apiError,
          });
      }
      projects.setProject(projectId, {
        status:
          operation === "shot" ||
          operation === "audio-generate" ||
          operation === "audio-replace" ||
          operation === "subtitle-compose"
            ? "storyboard_review"
            : operation === "regenerate-section"
              ? "script_review"
              : "failed",
        error: apiError,
      });
      context.change(job.id, { status: "failed", stage: "生成失败", error: apiError });
    }
  },
};
