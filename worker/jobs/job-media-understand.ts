import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve } from "node:path";
import {
  MediaUnderstandValidationError,
  resolveMediaUnderstandAssets,
} from "../../server/media-understand/job-service";
import { arkMediaUnderstanding } from "../../server/providers/ark-media-understanding";
import { ossutils } from "../../server/storage/ossutils";
import type { JobResult, StageProvenance } from "../../server/types";
import {
  buildMediaUnderstandPrompt,
  extractMediaUnderstandResult,
  type MediaUnderstandModelId,
  type MediaUnderstandReasoningEffort,
  MediaUnderstandRequestSchema,
  type MediaUnderstandResult,
  mediaUnderstandModels,
} from "../../shared/media-understand/contract";
import type { WorkerJobHandler } from "./types";

type MediaUnderstandClient = {
  configured: boolean;
  analyze(input: {
    model: MediaUnderstandModelId;
    reasoningEffort: MediaUnderstandReasoningEffort;
    prompt: string;
    media: Array<
      { kind: "image" | "video" | "audio"; url: string } | { kind: "image" | "video" | "audio"; fileId: string }
    >;
  }): Promise<{
    text: string;
    responseId?: string;
    model: string;
    usage?: Record<string, unknown>;
  }>;
  uploadMedia?(file: File): Promise<string>;
  deleteMedia?(fileId: string): Promise<void>;
};

interface MediaUnderstandJobDependencies {
  client?: MediaUnderstandClient;
  loadMedia?: (asset: { id: string; storageKey: string; originalName: string }, tempDir: string) => Promise<string>;
  uploadMedia?: (asset: { id: string; originalName: string; mimeType: string }, filePath: string) => Promise<string>;
  deleteMedia?: (fileId: string) => Promise<void>;
}

function mediaKind(mimeType: string): "image" | "video" | "audio" {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "image";
}

async function defaultLoadMedia(asset: { id: string; storageKey: string; originalName: string }, tempDir: string) {
  if (!ossutils.configured) throw new Error("TOS_NOT_CONFIGURED");
  const suffix =
    extname(asset.originalName)
      .replace(/[^A-Za-z0-9.]/g, "")
      .slice(0, 12) || ".bin";
  const path = resolve(tempDir, `${asset.id}${suffix}`);
  await ossutils.downloadLibraryFile(asset.storageKey, path);
  return path;
}

function cancelled(jobId: string, context: Parameters<WorkerJobHandler["execute"]>[1]) {
  return Boolean(context.store.get(jobId)?.cancelRequested);
}

function safeError(error: unknown) {
  const validation = error instanceof MediaUnderstandValidationError;
  const message = (error instanceof Error ? error.message : "素材理解失败")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[MEDIA_URL]")
    .replace(/(?:Bearer\s+)?[A-Za-z0-9_-]{24,}/g, "[REDACTED]")
    .slice(0, 500);
  return {
    code: validation
      ? error.code
      : error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")
        ? "MEDIA_UNDERSTAND_INVALID_RESULT"
        : "MEDIA_UNDERSTAND_PROVIDER_ERROR",
    message,
    retryable: !validation,
    requestId: crypto.randomUUID(),
  };
}

export function createMediaUnderstandJob(dependencies: MediaUnderstandJobDependencies = {}): WorkerJobHandler {
  const client = dependencies.client ?? arkMediaUnderstanding;
  const loadMedia = dependencies.loadMedia ?? defaultLoadMedia;
  const uploadMedia =
    dependencies.uploadMedia ??
    (async (asset: { originalName: string; mimeType: string }, filePath: string) => {
      if (!client.uploadMedia) throw new Error("ARK_MEDIA_UPLOAD_NOT_AVAILABLE");
      return client.uploadMedia(new File([Bun.file(filePath)], asset.originalName, { type: asset.mimeType }));
    });
  const deleteMedia =
    dependencies.deleteMedia ??
    (async (fileId: string) => {
      await client.deleteMedia?.(fileId);
    });
  return {
    name: "media-understand",
    supports: (job) => job.moduleId === "media-understand",
    async execute(job, context) {
      const provenance: StageProvenance[] = [];
      let providerStage: StageProvenance | undefined;
      let tempDir: string | undefined;
      const uploadedFileIds: string[] = [];
      try {
        if (!context.accounts) throw new Error("素材所有权服务不可用");
        if (!client.configured) throw new Error("ARK_NOT_CONFIGURED");
        const request = MediaUnderstandRequestSchema.parse(JSON.parse(job.values.mediaUnderstandRequest ?? ""));
        const assets = resolveMediaUnderstandAssets(
          job.ownerUserId,
          {
            primaryAssetId: request.primaryAssetId,
            referenceImageAssetIds: request.referenceImageAssetIds,
          },
          (ownerUserId, assetId) => context.accounts?.getOwnedAsset(ownerUserId, assetId),
        );
        const selectedModel = mediaUnderstandModels.find((model) => model.id === request.modelId);
        if (!selectedModel?.acceptedPrimaryKinds.includes(mediaKind(assets.primary.mimeType)))
          throw new MediaUnderstandValidationError(
            "MEDIA_UNDERSTAND_MODEL_UNSUPPORTED",
            "所选模型不支持当前主素材类型",
          );
        if (job.cancelRequested || cancelled(job.id, context)) {
          context.change(job.id, { status: "cancelled", stage: "已取消" });
          return;
        }
        tempDir = await mkdtemp(resolve(tmpdir(), "yaozuo-media-understand-"));
        const media: Array<{ kind: "image" | "video" | "audio"; fileId: string }> = [];
        for (const asset of [assets.primary, ...assets.references]) {
          const filePath = await loadMedia(asset, tempDir);
          const fileId = await uploadMedia(asset, filePath);
          uploadedFileIds.push(fileId);
          media.push({ kind: mediaKind(asset.mimeType), fileId });
        }
        providerStage = {
          id: `${job.id}:ark-media-understanding`,
          capability: "media-understand",
          executionMode: "real",
          implementation: "ark-responses-sdk",
          provider: "ark",
          model: request.modelId,
          startedAt: new Date().toISOString(),
        };
        context.change(job.id, {
          status: "processing",
          stage: "方舟正在理解素材",
          progress: 20,
          provenance: [providerStage],
          providerStatus: "processing",
          providerSubmittedAt: providerStage.startedAt,
        });
        const promptInput = {
          userPrompt: request.prompt,
          primaryMimeType: assets.primary.mimeType,
          referenceImageCount: assets.references.length,
        };
        let response = await client.analyze({
          model: request.modelId,
          reasoningEffort: request.reasoningEffort,
          prompt: buildMediaUnderstandPrompt(promptInput),
          media,
        });
        let result: MediaUnderstandResult;
        try {
          result = extractMediaUnderstandResult(response.text);
        } catch {
          context.change(job.id, {
            stage: "正在校正镜头脚本结构",
            progress: 72,
            providerTaskId: response.responseId,
          });
          response = await client.analyze({
            model: request.modelId,
            reasoningEffort: request.reasoningEffort,
            prompt: buildMediaUnderstandPrompt({ ...promptInput, repairText: response.text.slice(0, 2_000) }),
            media,
          });
          result = extractMediaUnderstandResult(response.text);
        }
        if (cancelled(job.id, context)) {
          providerStage.completedAt = new Date().toISOString();
          context.change(job.id, {
            status: "cancelled",
            stage: "已取消",
            progress: 72,
            provenance: [providerStage],
            providerTaskId: response.responseId,
            providerStatus: "completed_after_cancel",
          });
          return;
        }
        providerStage.completedAt = new Date().toISOString();
        provenance.push(providerStage);
        const text = `${JSON.stringify(result, null, 2)}\n`;
        const artifacts: JobResult["artifacts"] = [
          {
            id: crypto.randomUUID(),
            name: `${job.id}-shot-script.json`,
            mimeType: "application/json",
            text,
            executionMode: "real",
            lineage: provenance,
          },
        ];
        context.change(job.id, {
          status: "succeeded",
          stage: "镜头脚本已生成",
          progress: 100,
          provenance,
          providerTaskId: response.responseId,
          providerStatus: "completed",
          overallExecutionMode: "real",
          result: {
            kind: "media-understand",
            title: job.title,
            summary: `已生成 ${result.shots.length} 个镜头的结构化脚本。`,
            artifacts,
            data: {
              values: job.values,
              generatedAt: new Date().toISOString(),
              mock: false,
            },
          },
        });
        const owner = context.accounts.getUser(job.ownerUserId);
        if (owner && context.accounts.taskNotificationsEnabled(job.ownerUserId))
          context.accounts.createNotification(
            job.ownerUserId,
            "task_completed",
            "素材理解任务已完成",
            `${job.title} 已生成 JSON 镜头脚本。`,
            job.id,
          );
      } catch (error) {
        if (providerStage) {
          providerStage.completedAt = new Date().toISOString();
          provenance.push(providerStage);
        }
        const failure = safeError(error);
        context.change(job.id, {
          status: "failed",
          stage: "素材理解失败",
          provenance,
          providerStatus: "failed",
          error: failure,
        });
      } finally {
        await Promise.allSettled(uploadedFileIds.map((fileId) => deleteMedia(fileId)));
        if (tempDir) await rm(tempDir, { recursive: true, force: true });
      }
    },
  };
}

export const mediaUnderstandJob = createMediaUnderstandJob();
