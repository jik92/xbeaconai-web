import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "../../server/env";
import { extractAudio, extractFrame, generateSampleVideo, probeMedia } from "../../server/media/ffmpeg";
import { isSeedanceModelId, type SeedanceModelId } from "../../server/models/video-models";
import { aihubmix } from "../../server/providers/aihubmix";
import type { JobRecord, JobResult, StageProvenance } from "../../server/types";
import { APP_CONFIG } from "../../web/app/config";
import type { ModuleId } from "../../web/entities/types";
import { jobDefinitions } from "./definitions";
import { SeedanceFlowError, SeedanceVideoJob } from "./job-seedance-video";
import type { WorkerJobHandler } from "./types";

const wait = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const mockMedia = new Map<string, Promise<string>>();

type ArtifactDraft = {
  id: string;
  name: string;
  mimeType: string;
  url?: string;
  text?: string;
  executionMode: JobRecord["overallExecutionMode"];
};

async function ensureMockMedia(kind: "video" | "audio" | "image"): Promise<ArtifactDraft> {
  const extension = kind === "video" ? "mp4" : kind === "audio" ? "wav" : "png";
  const mimeType = kind === "video" ? "video/mp4" : kind === "audio" ? "audio/wav" : "image/png";
  const name = `mock-preview.${extension}`;
  const path = resolve(env.dataDir, "results", name);
  let pending = mockMedia.get(kind);
  if (!pending) {
    pending = (async () => {
      if (existsSync(path)) return path;
      const sample = resolve(env.dataDir, "results", "mock-preview.mp4");
      if (kind === "video") await generateSampleVideo(sample);
      else await ensureMockMedia("video");
      if (kind === "audio") await extractAudio(sample, path);
      if (kind === "image") await extractFrame(sample, path);
      return path;
    })();
    mockMedia.set(kind, pending);
  }
  await pending;
  return { id: crypto.randomUUID(), name, mimeType, url: `/api/artifacts/${name}`, executionMode: "mock" };
}

function overallMode(provenance: StageProvenance[], artifacts: ArtifactDraft[]): JobRecord["overallExecutionMode"] {
  const modes = new Set([
    ...provenance.map((stage) => stage.executionMode),
    ...artifacts.map((artifact) => artifact.executionMode),
  ]);
  return modes.size === 1 ? [...modes][0] : "mixed";
}

export const stageMap = Object.fromEntries(
  Object.entries(jobDefinitions).map(([moduleId, definition]) => [moduleId, definition.stages]),
) as Record<ModuleId, Array<[string, string]>>;

const textCapabilities = new Set([
  "text-generate",
  "structured-output",
  "text-rewrite",
  "storyboard",
  "prompt-understand",
  "text-variants",
  "variant-plan",
  "asset-arrange",
]);
const verifiedSdkIds = new Set<string>();
for (const file of ["capabilities.json", "ffmpeg-capabilities.json"])
  try {
    const capabilityFile = JSON.parse(readFileSync(resolve(env.dataDir, file), "utf8")) as {
      entries?: Array<{ id: string; status: string }>;
    };
    for (const entry of capabilityFile.entries ?? [])
      if (entry.status === "verified" || entry.status === "local") verifiedSdkIds.add(entry.id);
  } catch {
    /* no verified capabilities in this environment */
  }

export function buildExecutionPlan(
  moduleId: ModuleId,
  values: Record<string, string>,
  videoModel?: SeedanceModelId,
): StageProvenance[] {
  return stageMap[moduleId].map(([capability], index) => {
    let executionMode: StageProvenance["executionMode"] = "mock",
      implementation = "yaozuo-mock-provider",
      model: string | undefined;
    const localSdkId = capability.includes("probe")
      ? "ffmpeg-probe"
      : capability.includes("compose")
        ? "ffmpeg-compose"
        : capability.includes("split")
          ? "ffmpeg-split"
          : capability === "video-denoise"
            ? "ffmpeg-denoise"
            : undefined;
    if (localSdkId && verifiedSdkIds.has(localSdkId)) {
      executionMode = "local";
      implementation = "ffmpeg-local";
    } else if (
      !env.forceMock &&
      aihubmix.configured &&
      verifiedSdkIds.has("aihubmix-text") &&
      textCapabilities.has(capability)
    ) {
      executionMode = "real";
      implementation = "aihubmix-text";
      model = "gpt-4.1-nano-free";
    } else if (
      !env.forceMock &&
      aihubmix.configured &&
      verifiedSdkIds.has("aihubmix-audio") &&
      capability === "speech-synthesize"
    ) {
      executionMode = "real";
      implementation = "aihubmix-audio";
      model = "tts-1";
    } else if (!env.forceMock && aihubmix.configured && videoModel && capability === "video-generate") {
      executionMode = "real";
      implementation = "aihubmix-video";
      model = videoModel;
    } else if (!env.forceMock && aihubmix.configured && capability === "multimodal-generate") {
      const type = values.type ?? "营销文案";
      executionMode = "real";
      if (type === "图片" && values.modelId === "gpt-image-1-mini" && verifiedSdkIds.has("aihubmix-image")) {
        implementation = "aihubmix-image";
        model = "gpt-image-1-mini";
      } else if (type === "视频" && videoModel) {
        implementation = "aihubmix-video";
        model = videoModel;
      } else if (type !== "图片" && type !== "视频" && verifiedSdkIds.has("aihubmix-text")) {
        implementation = "aihubmix-text";
        model = "gpt-4.1-nano-free";
      } else {
        executionMode = "mock";
        implementation = "yaozuo-mock-provider";
        model = undefined;
      }
    }
    return {
      id: `plan:${index}:${capability}`,
      capability,
      executionMode,
      implementation,
      provider: executionMode === "real" ? "aihubmix" : undefined,
      model,
      fallbackReason: executionMode === "mock" ? "真实接口尚未映射或测试环境强制 Mock" : undefined,
      startedAt: "",
    };
  });
}

export const genericCreationJob: WorkerJobHandler = {
  name: "generic-creation",
  supports: () => true,
  async execute(initialJob, context) {
    let job = initialJob;
    const id = job.id;
    if (job.values.__scenario === "insufficient-credits") {
      await wait(250);
      context.change(id, {
        status: "failed",
        stage: "计费校验",
        progress: 0,
        error: {
          code: "INSUFFICIENT_CREDITS",
          message: "创作点不足，请调整任务或充值",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      });
      return;
    }
    const definition = jobDefinitions[job.moduleId];
    const stages = definition.stages;
    const plan = job.executionPlan.length
      ? job.executionPlan
      : buildExecutionPlan(job.moduleId, job.values, job.videoModel);
    if (!job.executionPlan.length) context.change(id, { executionPlan: plan });
    const processingJob = context.change(id, {
      status: "processing",
      stage: stages[0][1],
      progress: Math.max(5, job.progress),
    });
    if (!processingJob) return;
    job = processingJob;
    const provenance: StageProvenance[] = job.providerTaskId
      ? job.provenance.filter((stage) => Boolean(stage.completedAt))
      : [];
    const produced: ArtifactDraft[] = [];
    const resumedVideoIndex = job.providerTaskId
      ? plan.findIndex((stage) => stage.implementation === "aihubmix-video")
      : -1;
    for (let index = resumedVideoIndex >= 0 ? resumedVideoIndex : 0; index < stages.length; index += 1) {
      const latest = context.store.get(id);
      if (!latest || latest.cancelRequested) {
        context.change(id, { status: "cancelled", stage: "已取消", progress: latest?.progress ?? 0 });
        return;
      }
      const [capability, label] = stages[index];
      if (job.values.__scenario === "fail-analysis" && index === Math.min(1, stages.length - 1)) {
        await wait(300);
        context.change(id, {
          status: "failed",
          stage: `${label}失败`,
          progress: 42,
          provenance,
          error: {
            code: "PROCESSING_FAILED",
            message: "素材分析中断，请检查文件后重试",
            retryable: true,
            requestId: crypto.randomUUID(),
          },
        });
        return;
      }
      const stage: StageProvenance = {
        ...plan[index],
        id: `${id}:${index}`,
        startedAt: new Date().toISOString(),
      };
      context.change(id, {
        stage: label,
        progress: Math.round(8 + (index / stages.length) * 82),
        provenance: [...provenance, stage],
        overallExecutionMode: "mixed",
      });
      try {
        if (stage.executionMode === "real" && stage.implementation === "aihubmix-text") {
          const response = await aihubmix.generateText(
            `你是${APP_CONFIG.projectName}创作助手。为 ${job.moduleId} 执行 ${capability}。用户配置：${JSON.stringify(job.values)}。输出简洁中文结果。`,
            stage.model,
          );
          produced.push({
            id: crypto.randomUUID(),
            name: `${capability}.txt`,
            mimeType: "text/plain",
            text: response.text,
            executionMode: "real",
          });
        } else if (stage.executionMode === "real" && stage.implementation === "aihubmix-image") {
          const response = await aihubmix.generateImage(
            job.values.prompt || "A polished product advertising image, clean studio lighting",
            stage.model,
          );
          if (!response.b64_json && !response.url) throw new Error("图片生成接口未返回可用内容");
          const bytes = response.b64_json
            ? Uint8Array.from(atob(response.b64_json), (character) => character.charCodeAt(0))
            : await fetch(response.url as string).then((item) => item.bytes());
          const name = `${id}-${capability}.png`;
          await Bun.write(resolve(env.dataDir, "results", name), bytes);
          produced.push({
            id: crypto.randomUUID(),
            name,
            mimeType: "image/png",
            url: `/api/artifacts/${name}`,
            executionMode: "real",
          });
        } else if (stage.executionMode === "real" && stage.implementation === "aihubmix-audio") {
          const response = await aihubmix.synthesizeSpeech(
            job.values.topic || job.values.prompt || `${APP_CONFIG.projectName}智能创作结果已生成。`,
            stage.model,
          );
          const name = `${id}-${capability}.wav`;
          await Bun.write(resolve(env.dataDir, "results", name), response.bytes);
          produced.push({
            id: crypto.randomUUID(),
            name,
            mimeType: "audio/wav",
            url: `/api/artifacts/${name}`,
            executionMode: "real",
          });
        } else if (stage.executionMode === "real" && stage.implementation === "aihubmix-video") {
          if (!isSeedanceModelId(stage.model))
            throw new SeedanceFlowError("INVALID_VIDEO_MODEL", "视频模型无效", false);
          const response = await new SeedanceVideoJob(context).execute(job, stage.model);
          const name = `${id}-${capability}.mp4`;
          await Bun.write(resolve(env.dataDir, "results", name), response.bytes);
          await probeMedia(resolve(env.dataDir, "results", name));
          produced.push({
            id: crypto.randomUUID(),
            name,
            mimeType: "video/mp4",
            url: `/api/artifacts/${name}`,
            executionMode: "real",
          });
        } else await wait(stage.executionMode === "mock" ? 350 : 120);
      } catch (error) {
        if (error instanceof SeedanceFlowError && error.code === "JOB_CANCELLED") {
          context.change(id, { status: "cancelled", stage: "已取消", error: undefined });
          return;
        }
        if (stage.implementation === "aihubmix-video" || !env.allowMockFallback) {
          context.change(id, {
            status: "failed",
            stage: `${label}失败`,
            error: {
              code: error instanceof SeedanceFlowError ? error.code : "PROVIDER_ERROR",
              message: error instanceof Error ? error.message : "上游接口失败",
              retryable: error instanceof SeedanceFlowError ? error.retryable : true,
              requestId: crypto.randomUUID(),
            },
          });
          return;
        }
        stage.executionMode = "mock";
        stage.implementation = "yaozuo-mock-provider";
        stage.fallbackReason = error instanceof Error ? error.message : "上游接口失败";
        await wait(350);
      }
      stage.completedAt = new Date().toISOString();
      provenance.push(stage);
      context.change(id, { progress: Math.round(8 + ((index + 1) / stages.length) * 82), provenance: [...provenance] });
    }
    const expected = definition.outputKind(job.values);
    if (expected !== "text" && !produced.some((artifact) => artifact.mimeType.startsWith(`${expected}/`)))
      produced.push(await ensureMockMedia(expected));
    const finalArtifacts: ArtifactDraft[] = produced.length
      ? produced
      : [
          {
            id: crypto.randomUUID(),
            name: `${job.moduleId}-result.json`,
            mimeType: "application/json",
            text: definition.summary,
            executionMode: provenance.some((stage) => stage.executionMode === "real") ? "real" : "mock",
          },
        ];
    const owner = context.accounts?.getUser(job.ownerUserId);
    for (const artifact of finalArtifacts)
      if (artifact.url && context.accounts && owner) {
        context.accounts.createArtifact({
          id: artifact.id,
          ownerUserId: job.ownerUserId,
          jobId: job.id,
          storageKey: artifact.name,
          name: artifact.name,
          mimeType: artifact.mimeType,
          createdAt: new Date().toISOString(),
        });
        artifact.url = `/api/artifacts/${artifact.id}`;
      }
    const artifactMode = overallMode(provenance, finalArtifacts);
    const result: JobResult = {
      kind: job.moduleId,
      title: job.title,
      summary: definition.summary,
      artifacts: finalArtifacts.map((artifact) => ({ ...artifact, lineage: provenance })),
      data: {
        values: job.values,
        generatedAt: new Date().toISOString(),
        mock: artifactMode === "mock" || artifactMode === "mixed",
      },
    };
    context.change(id, {
      status: job.values.__scenario === "partial-batch" ? "partially_succeeded" : "succeeded",
      stage: job.values.__scenario === "partial-batch" ? "部分完成" : "已完成",
      progress: 100,
      provenance,
      result,
      overallExecutionMode: artifactMode,
    });
    if (owner && context.accounts?.taskNotificationsEnabled(job.ownerUserId))
      context.accounts.createNotification(
        job.ownerUserId,
        "task_completed",
        "创作任务已完成",
        `${job.title} 已生成，可前往任务中心查看。`,
        job.id,
      );
  },
};
