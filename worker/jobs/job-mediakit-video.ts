import { env } from "../../server/env";
import {
  MediaKitError,
  type MediaKitTask,
  type MediaKitTool,
  volcMediaKit,
} from "../../server/providers/volc-mediakit";
import { ossutils } from "../../server/storage/ossutils";
import type { StageProvenance } from "../../server/types";
import type { ModuleId } from "../../web/entities/types";
import type { WorkerJobHandler } from "./types";

const successStatuses = new Set(["completed", "succeeded", "success"]);
const failedStatuses = new Set(["failed", "cancelled", "canceled", "expired", "error"]);

interface MediaKitJobConfig {
  moduleId: Extract<ModuleId, "subtitle-erase" | "video-enhancement">;
  tool: MediaKitTool;
  capability: string;
  processingLabel: string;
  resultSuffix: string;
  summary: string;
}

function safeFileBase(value: string) {
  return (
    value
      .replace(/\.[^.]+$/, "")
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .slice(0, 80) || "video"
  );
}

function taskFailure(task: MediaKitTask) {
  const code = task.error?.code?.trim() || `TASK_${task.status ?? "FAILED"}`;
  const message = task.error?.message?.trim() || "AI MediaKit 任务处理失败";
  return new MediaKitError(
    `MEDIAKIT_${code}`,
    message.replace(/https?:\/\/\S+/g, "[redacted-url]"),
    false,
    task.request_id,
  );
}

function progressFor(status: string) {
  if (["pending", "queued", "created"].includes(status)) return 20;
  if (["running", "processing"].includes(status)) return 55;
  return 35;
}

function errorResult(error: unknown) {
  if (error instanceof MediaKitError)
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      requestId: error.requestId ?? crypto.randomUUID(),
    };
  return {
    code: "MEDIAKIT_WORKER_ERROR",
    message: error instanceof Error ? error.message : "AI MediaKit 任务失败",
    retryable: true,
    requestId: crypto.randomUUID(),
  };
}

function createMediaKitJob(config: MediaKitJobConfig): WorkerJobHandler {
  return {
    name: `mediakit-${config.moduleId}`,
    supports: (job) => job.moduleId === config.moduleId,
    async execute(initialJob, context) {
      const { accounts, store } = context;
      if (!accounts) throw new Error("素材所有权服务不可用");
      if (!ossutils.configured) throw new Error("TOS_NOT_CONFIGURED: MediaKit 视频工具需要私有 TOS");
      if (!volcMediaKit.configured)
        throw new MediaKitError("MEDIAKIT_NOT_CONFIGURED", "AI MediaKit API Key 未配置", false);
      const sourceAssetId = initialJob.values.source?.split(":", 3)[1];
      if (!sourceAssetId) throw new Error("视频素材标识无效");
      const sourceAsset = accounts.getOwnedAsset(initialJob.ownerUserId, sourceAssetId);
      if (!sourceAsset?.mimeType.startsWith("video/")) throw new Error("视频素材不存在或不属于当前账号");

      const stage: StageProvenance = {
        id: `${initialJob.id}:${config.capability}`,
        capability: config.capability,
        executionMode: "real",
        implementation: config.tool,
        provider: "volcengine-ai-mediakit",
        startedAt: initialJob.provenance[0]?.startedAt || new Date().toISOString(),
      };
      context.change(initialJob.id, {
        status: "processing",
        stage: initialJob.providerTaskId ? "正在恢复云端任务" : "正在提交云端任务",
        progress: Math.max(8, initialJob.progress),
        executionPlan: [stage],
        provenance: [stage],
        overallExecutionMode: "real",
      });

      try {
        let job = store.get(initialJob.id) ?? initialJob;
        let taskId = job.providerTaskId;
        if (!taskId) {
          context.change(job.id, { providerStatus: "submitting", providerSubmittedAt: new Date().toISOString() });
          const sourceUrl = ossutils.createSignedReadUrl(sourceAsset.storageKey, 24 * 60 * 60);
          const submitted = await volcMediaKit.submit(config.tool, sourceUrl);
          taskId = submitted.taskId;
          const submittedAt = new Date();
          job =
            context.change(job.id, {
              providerTaskId: taskId,
              providerStatus: "submitted",
              providerSubmittedAt: submittedAt.toISOString(),
              providerDeadlineAt: new Date(submittedAt.getTime() + env.mediaKit.pollTimeoutMs).toISOString(),
              stage: config.processingLabel,
              progress: 15,
            }) ?? job;
        }

        const deadline = new Date(job.providerDeadlineAt ?? Date.now() + env.mediaKit.pollTimeoutMs).getTime();
        let completed: MediaKitTask | undefined;
        while (true) {
          const latest = store.get(job.id);
          if (!latest || latest.cancelRequested) {
            context.change(job.id, {
              status: "cancelled",
              stage: "已取消本地等待，上游任务可能继续处理",
              providerCancelState: "unsupported",
            });
            return;
          }
          const task = await volcMediaKit.retrieve(taskId);
          const status = task.status?.toLowerCase() ?? "unknown";
          context.change(job.id, {
            providerStatus: status,
            stage: config.processingLabel,
            progress: Math.max(latest.progress, progressFor(status)),
          });
          if (successStatuses.has(status)) {
            completed = task;
            break;
          }
          if (failedStatuses.has(status)) throw taskFailure(task);
          if (Date.now() >= deadline)
            throw new MediaKitError("MEDIAKIT_TASK_TIMEOUT", "AI MediaKit 任务等待超时，可稍后重试恢复", true);
          await Bun.sleep(env.mediaKit.pollIntervalMs);
        }
        const resultUrl = completed.result?.video_url;
        if (!resultUrl)
          throw new MediaKitError(
            "MEDIAKIT_RESULT_URL_MISSING",
            "AI MediaKit 已完成但未返回视频地址",
            true,
            completed.request_id,
          );

        context.change(job.id, { stage: "正在保存处理结果", progress: 88, providerStatus: "completed" });
        const bytes = await volcMediaKit.download(resultUrl);
        const folderId = accounts.getDefaultAssetFolderId(job.ownerUserId);
        const folder = accounts.getAssetFolder(job.ownerUserId, folderId);
        if (!folder) throw new Error("默认素材文件夹不存在");
        const fileName = `${safeFileBase(sourceAsset.originalName)}-${config.resultSuffix}.mp4`;
        const storageKey = `${folder.storagePrefix}generated/${job.id}/${fileName}`;
        await ossutils.putLibraryBytes({ bytes, key: storageKey, mimeType: "video/mp4" });
        const assetId = crypto.randomUUID();
        accounts.createAsset({
          id: assetId,
          ownerUserId: job.ownerUserId,
          storageKey,
          originalName: fileName,
          mimeType: "video/mp4",
          byteSize: bytes.byteLength,
          durationSec: completed.result?.duration,
          kind: "media",
          displayName: `${sourceAsset.displayName}-${config.resultSuffix}`,
          description: `由 AI MediaKit ${config.summary}`,
          folderId: folder.id,
          createdAt: new Date().toISOString(),
        });
        stage.completedAt = new Date().toISOString();
        context.change(job.id, {
          status: "succeeded",
          stage: "已完成并保存到素材库",
          progress: 100,
          providerStatus: "completed",
          provenance: [stage],
          overallExecutionMode: "real",
          result: {
            kind: config.moduleId,
            title: job.title,
            summary: `${config.summary}，结果已保存到“${folder.name}”。`,
            artifacts: [
              {
                id: assetId,
                name: fileName,
                mimeType: "video/mp4",
                url: `/api/assets/${assetId}/content`,
                executionMode: "real",
                lineage: [stage],
              },
            ],
            data: {
              values: { ...job.values, outputFolderId: folder.id, providerTaskId: taskId },
              generatedAt: new Date().toISOString(),
              mock: false,
            },
          },
        });
        if (accounts.taskNotificationsEnabled(job.ownerUserId))
          accounts.createNotification(job.ownerUserId, "task_completed", `${job.title}已完成`, config.summary, job.id);
      } catch (error) {
        const latest = store.get(initialJob.id);
        if (latest?.status === "cancelled") return;
        context.change(initialJob.id, {
          status: "failed",
          stage: "MediaKit 处理失败",
          overallExecutionMode: "real",
          error: errorResult(error),
        });
      }
    },
  };
}

export const subtitleEraseJob = createMediaKitJob({
  moduleId: "subtitle-erase",
  tool: "erase-video-subtitle-pro",
  capability: "subtitle-erase-pro",
  processingLabel: "正在精细擦除字幕",
  resultSuffix: "无字幕",
  summary: "精细字幕擦除已完成",
});

export const videoEnhancementJob = createMediaKitJob({
  moduleId: "video-enhancement",
  tool: "enhance-video-fast",
  capability: "video-enhance-fast",
  processingLabel: "正在极速增强画质",
  resultSuffix: "画质增强",
  summary: "极速画质增强已完成",
});
