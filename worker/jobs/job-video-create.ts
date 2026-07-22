import { resolve } from "node:path";
import { env } from "../../server/env";
import { concatVideos, generateSampleVideo, probeMedia } from "../../server/media/ffmpeg";
import { isSeedanceModelId } from "../../server/models/video-models";
import { getPortraitById } from "../../server/portraits/catalog";
import type { JobRecord, StageProvenance } from "../../server/types";
import {
  analyzeVideoCreateProduct,
  generateVideoCreateScript,
  generateVideoCreateStoryboard,
  regenerateVideoCreateSection,
} from "../../server/video-create/model";
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
        projects.updateShot(shot.id, { status: "succeeded", videoAssetId: artifact.id, error: null });
        projects.setProject(projectId, { status: "storyboard_review", error: null });
        currentStage.completedAt = new Date().toISOString();
        context.change(job.id, {
          status: "succeeded",
          stage: "已完成",
          progress: 100,
          provenance: [currentStage],
          result: artifactResult(job, artifact, [currentStage]),
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
          const output = resolve(env.dataDir, "results", `${job.id}-compose-source.mp4`);
          if (inputs.length === 1) await Bun.write(output, Bun.file(inputs[0]));
          else await concatVideos(inputs, output);
          artifact = await saveVideoArtifact(job, context, undefined, output, "local");
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
