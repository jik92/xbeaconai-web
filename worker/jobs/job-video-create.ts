import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
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
import { getPortraitById } from "../../server/portraits/catalog";
import { aihubmix } from "../../server/providers/aihubmix";
import type { JobRecord, StageProvenance } from "../../server/types";
import {
  analyzeVideoCreateProduct,
  generateVideoCreateScript,
  generateVideoCreateStoryboard,
  regenerateVideoCreateSection,
} from "../../server/video-create/model";
import type { VideoCreateSubtitleCue } from "../../server/video-create/types";
import { VIDEO_CREATE_ANALYSIS_MODEL } from "../../server/video-create/types";
import { videoCreateError } from "../../server/video-create/video-create-store";
import { SeedanceVideoJob } from "./job-seedance-video";
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
    provider: executionMode === "real" ? "aihubmix" : undefined,
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
) {
  const name = `${job.id}-video-create.mp4`;
  const output = resolve(env.dataDir, "results", name);
  if (bytes) await Bun.write(output, bytes);
  else if (sourcePath) await Bun.write(output, Bun.file(sourcePath));
  else await generateSampleVideo(output);
  await probeMedia(output);
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
  return { id, name, mimeType: "video/mp4", executionMode } as const;
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
    return { startSec, endSec: Number(Math.max(cursor, startSec + 0.01).toFixed(2)), text: phrase };
  });
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

async function saveShotAudio(job: JobRecord, context: JobHandlerContext, shotId: string, text: string, mock: boolean) {
  if (!context.accounts) throw new Error("ACCOUNT_STORE_UNAVAILABLE");
  const name = `${job.id}-${shotId}-voice.wav`;
  const output = resolve(env.dataDir, "results", name);
  const response = mock ? undefined : await aihubmix.synthesizeSpeech(text, "tts-1", "alloy");
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
    mimeType: response?.mimeType.split(";")[0] || "audio/wav",
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
    const mode = usesMockVideo ? "mock" : operation === "compose" ? "local" : "real";
    const implementation =
      mode === "mock"
        ? env.mockGenerateVideoApi && job.values.__mockVideo !== "true"
          ? "ffmpeg-seedance-mock"
          : "video-create-test-mock"
        : mode === "local"
          ? "ffmpeg-concat"
          : operation === "analyze"
            ? "aihubmix-gpt-image-analysis"
            : operation === "shot"
              ? "aihubmix-video"
              : "aihubmix-text";
    const model =
      operation === "analyze" ? VIDEO_CREATE_ANALYSIS_MODEL : operation === "shot" ? job.videoModel : "deepseek-v4-pro";
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
        const portrait = getPortraitById(aggregate.project.input.portraitId);
        if (aggregate.project.input.portraitId && !portrait) throw new Error("PORTRAIT_NOT_AVAILABLE");
        const recommendation = await analyzeVideoCreateProduct(
          assets.filter((asset): asset is NonNullable<typeof asset> => Boolean(asset)),
          portrait,
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
        const generated = await generateVideoCreateStoryboard(aggregate);
        projects.replaceShots(projectId, generated);
      } else if (operation === "shot") {
        const shotId = job.values.shotId;
        const shot = aggregate.shots.find((item) => item.id === shotId);
        if (!shot) throw new Error("SHOT_NOT_FOUND");
        projects.updateShot(shot.id, { status: "generating", jobId: job.id, attempts: shot.attempts + 1, error: null });
        const section = aggregate.sections.find((item) => item.id === shot.scriptSectionId);
        const narration = section?.currentVersion?.text.trim();
        if (!narration) throw new Error("SHOT_SCRIPT_NOT_AVAILABLE");
        const mockAudio = job.values.__mockAudio === "true";
        const audioStage = stage(
          job,
          "speech-synthesis",
          mockAudio ? "mock" : "real",
          mockAudio ? "video-create-test-mock-audio" : "aihubmix-audio",
          "tts-1",
        );
        const audio = await saveShotAudio(job, context, shot.id, narration, mockAudio);
        audioStage.completedAt = new Date().toISOString();
        const subtitleCues = buildSubtitleCues(narration, audio.durationSec);
        let artifact: Awaited<ReturnType<typeof saveVideoArtifact>>;
        if (job.values.__mockVideo === "true")
          artifact = await saveVideoArtifact(job, context, undefined, undefined, "mock");
        else {
          if (!job.videoModel || !isSeedanceModelId(job.videoModel)) throw new Error("VIDEO_MODEL_REQUIRED");
          const response = await new SeedanceVideoJob(context).execute(job, job.videoModel);
          currentStage.executionMode = response.executionMode;
          currentStage.implementation = response.implementation;
          currentStage.provider = response.executionMode === "real" ? "aihubmix" : undefined;
          currentStage.model = response.executionMode === "real" ? job.videoModel : undefined;
          artifact = await saveVideoArtifact(job, context, response.bytes, undefined, response.executionMode);
        }
        projects.updateShot(shot.id, {
          status: "succeeded",
          videoAssetId: artifact.id,
          audioArtifactId: audio.id,
          subtitleCues,
          error: null,
        });
        projects.setProject(projectId, { status: "storyboard_review", error: null });
        currentStage.completedAt = new Date().toISOString();
        context.change(job.id, {
          status: "succeeded",
          stage: "已完成",
          progress: 100,
          provenance: [audioStage, currentStage],
          overallExecutionMode: artifact.executionMode === audioStage.executionMode ? artifact.executionMode : "mixed",
          result: artifactResult(job, artifact, [audioStage, currentStage]),
        });
        return;
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
              if (shot.audioEnabled && shot.audioArtifactId) {
                const audio = context.accounts.getArtifact(job.ownerUserId, shot.audioArtifactId);
                if (!audio) throw new Error("SHOT_AUDIO_NOT_AVAILABLE");
                const audioOutput = resolve(env.dataDir, "results", `${job.id}-shot-${shot.ordinal}-audio.mp4`);
                await composeMedia(prepared, resolve(env.dataDir, "results", audio.storage_key), audioOutput);
                prepared = audioOutput;
                temporaryFiles.push(audioOutput);
              }
              if (shot.subtitleEnabled && shot.subtitleCues.length) {
                const subtitlePath = resolve(env.dataDir, "results", `${job.id}-shot-${shot.ordinal}.srt`);
                const subtitleOutput = resolve(env.dataDir, "results", `${job.id}-shot-${shot.ordinal}-subtitle.mp4`);
                await Bun.write(subtitlePath, cuesToSrt(shot.subtitleCues));
                temporaryFiles.push(subtitlePath);
                await burnSubtitleFile(prepared, subtitlePath, subtitleOutput);
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
      if (shotId) projects.updateShot(shotId, { status: "failed", error: apiError });
      projects.setProject(projectId, {
        status:
          operation === "shot" ? "storyboard_review" : operation === "regenerate-section" ? "script_review" : "failed",
        error: apiError,
      });
      context.change(job.id, { status: "failed", stage: "生成失败", error: apiError });
    }
  },
};
