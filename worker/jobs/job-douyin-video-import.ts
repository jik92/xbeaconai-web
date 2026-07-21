import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { env } from "../../server/env";
import { cleanupDownloadDir, DouyinDownloadError } from "../../server/imports/douyin-video";
import { emitLog, logFailure, sanitizeError, stageComplete, stageStart } from "../../server/imports/import-logger";
import { platformAdapters, ShareContentParser } from "../../server/imports/share-content";
import { probeMedia } from "../../server/media/ffmpeg";
import { ossutils } from "../../server/storage/ossutils";
import type { JobResult, StageProvenance } from "../../server/types";
import type { WorkerJobHandler } from "./types";

const shareParser = new ShareContentParser(platformAdapters);

class AssetCreateError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "AssetCreateError";
  }
}

export const douyinVideoImportJob: WorkerJobHandler = {
  name: "share-content-import",
  supports: (job) => job.moduleId === "douyin-video-import" || job.moduleId === "share-content-import",
  async execute(job, context) {
    const { accounts, store } = context;
    if (!accounts) throw new Error("素材所有权服务不可用");

    const importStartMs = stageStart();

    const folderId = job.values.folderId;
    if (!folderId) throw new Error("缺少目标文件夹");
    const folder = accounts.getAssetFolder(job.ownerUserId, folderId);
    if (!folder) throw new Error("目标文件夹不存在或不属于当前账号");

    const platformId = job.values.platformId ?? "douyin";
    const normalizedUrl = job.values.normalizedUrl ?? job.values.shareUrl;
    if (!normalizedUrl) throw new Error("缺少分享链接");

    const adapter = shareParser.adapterFor(platformId);
    if (!adapter) throw new Error(`不支持的平台: ${platformId}`);

    if (!adapter.supportsDownload) {
      logFailure(job.id, "failure", importStartMs, "DOWNLOAD_NOT_SUPPORTED", `${adapter.displayName} 下载尚未实现`);
      context.change(job.id, {
        status: "failed",
        stage: "该平台尚未支持下载",
        error: {
          code: "DOWNLOAD_NOT_SUPPORTED",
          message: `${adapter.displayName} 当前仅支持识别，下载功能尚未实现`,
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      });
      return;
    }

    const plan: StageProvenance[] = [
      {
        id: `${job.id}:download`,
        capability: "share-download",
        executionMode: "real",
        implementation: "playwright-download",
        startedAt: new Date().toISOString(),
      },
    ];

    context.change(job.id, {
      status: "processing",
      stage: "正在下载视频",
      progress: 10,
      executionPlan: plan,
      provenance: [plan[0]],
      overallExecutionMode: "real",
    });

    let downloadResult: Awaited<ReturnType<typeof adapter.download>> | undefined;
    let storageKey: string | undefined;
    let assetId: string | undefined;
    let destPath: string | undefined;
    let tosUploaded = false;
    const tosConfigured = context.tosConfigured ?? ossutils.configured;

    try {
      // ── Cancel check ──────────────────────────────────────────
      const precheck = store.get(job.id);
      if (!precheck || precheck.cancelRequested) {
        context.change(job.id, { status: "cancelled", stage: "已取消" });
        logFailure(job.id, "cancel", importStartMs, "CANCELLED", "任务在下载前被取消");
        emitLog({
          jobId: job.id,
          stage: "cleanup",
          result: "ok",
          durationMs: Date.now() - importStartMs,
          errorSummary: "no temp dir",
        });
        return;
      }

      // ── Download ─────────────────────────────────────────────
      emitLog({ jobId: job.id, stage: "download_start", result: "ok", durationMs: Date.now() - importStartMs });
      const dlStart = stageStart();
      const isMocked = !!context.downloadFn;
      try {
        if (context.downloadFn) {
          downloadResult = await context.downloadFn(platformId, normalizedUrl);
        } else {
          downloadResult = await adapter.download(normalizedUrl);
        }
      } catch (dlErr) {
        const s = sanitizeError(dlErr);
        logFailure(job.id, "download_failure", dlStart, s.code, s.summary);
        throw dlErr;
      }
      stageComplete(job.id, "download_complete", dlStart, downloadResult.byteSize);

      // ── Cancel check ──────────────────────────────────────────
      const midcheck = store.get(job.id);
      if (!midcheck || midcheck.cancelRequested) {
        context.change(job.id, { status: "cancelled", stage: "已取消" });
        logFailure(job.id, "cancel", importStartMs, "CANCELLED", "任务在下载后被取消");
        return;
      }

      // ── Probe ────────────────────────────────────────────────
      if (!isMocked) {
        context.change(job.id, { stage: "正在验证视频", progress: 50 });
        emitLog({ jobId: job.id, stage: "probe_start", result: "ok", durationMs: Date.now() - importStartMs });
        const probeStart = stageStart();
        try {
          const probe = await probeMedia(downloadResult.filePath);
          const hasVideo = probe.streams.some((s) => s.codec_type === "video");
          if (!hasVideo) {
            throw new DouyinDownloadError("下载的文件不包含视频流，可能不是有效视频", false, "download_failed");
          }
          stageComplete(job.id, "probe_complete", probeStart);
        } catch (probeErr) {
          const s = sanitizeError(probeErr);
          logFailure(job.id, "probe_failure", probeStart, s.code, s.summary);
          throw probeErr;
        }
      }

      context.change(job.id, { stage: "正在保存视频", progress: 60 });

      const file = Bun.file(downloadResult.filePath);
      const byteSize = downloadResult.byteSize;
      const ext = ".mp4";
      const sanitizedName = `${platformId}_import`;

      assetId = crypto.randomUUID();
      storageKey = `${folder.storagePrefix}${assetId}${ext}`;
      const uploadRoot = resolve(env.dataDir, "uploads");
      destPath = resolve(uploadRoot, storageKey);

      // ── Local save ────────────────────────────────────────────
      emitLog({ jobId: job.id, stage: "save_local_start", result: "ok", durationMs: Date.now() - importStartMs });
      const localStart = stageStart();
      try {
        mkdirSync(dirname(destPath), { recursive: true, mode: 0o700 });
        await Bun.write(destPath, file);
      } catch (saveErr) {
        const s = sanitizeError(saveErr);
        logFailure(job.id, "save_local_failure", localStart, s.code, s.summary);
        throw saveErr;
      }
      stageComplete(job.id, "save_local_complete", localStart, byteSize);

      // ── TOS upload ────────────────────────────────────────────
      if (tosConfigured) {
        emitLog({ jobId: job.id, stage: "tos_upload_start", result: "ok", durationMs: Date.now() - importStartMs });
        const tosStart = stageStart();
        const uploadFn =
          context.tosUploadFn ??
          ((fp: string, key: string, mt: string, sz: number) =>
            ossutils.putLibraryFile({ filePath: fp, key, mimeType: mt, sizeBytes: sz }));
        try {
          await uploadFn(downloadResult.filePath, storageKey, "video/mp4", byteSize);
          stageComplete(job.id, "tos_upload_complete", tosStart, byteSize);
          tosUploaded = true;
        } catch (tosErr) {
          const s = sanitizeError(tosErr);
          logFailure(job.id, "tos_upload_failure", tosStart, s.code, s.summary);
          // TOS upload failure is fatal when TOS is configured
          if (destPath) await rm(destPath, { force: true }).catch(() => {});
          const delFn = context.tosDeleteFn ?? ((key: string) => ossutils.deleteObject(key));
          await delFn(storageKey).catch(() => {});
          throw new DouyinDownloadError(`TOS 上传失败: ${s.summary}`, true, "download_failed");
        }
      } else {
        emitLog({
          jobId: job.id,
          stage: "tos_skip",
          result: "ok",
          durationMs: 0,
          errorSummary: "TOS not configured",
        });
      }

      // ── Create asset ──────────────────────────────────────────
      const assetStart = stageStart();
      try {
        accounts.createAsset({
          id: assetId,
          ownerUserId: job.ownerUserId,
          storageKey,
          originalName: `${sanitizedName}.mp4`,
          mimeType: "video/mp4",
          byteSize,
          kind: "media",
          displayName: `${adapter.displayName}导入视频`,
          description: `从 ${normalizedUrl.slice(0, 200)} 导入`,
          folderId: folder.id,
          createdAt: new Date().toISOString(),
        });
      } catch (assetErr) {
        const s = sanitizeError(assetErr);
        logFailure(job.id, "asset_create_failure", assetStart, s.code, s.summary);
        throw new AssetCreateError(assetErr);
      }
      stageComplete(job.id, "asset_created", assetStart, byteSize);

      plan[0].completedAt = new Date().toISOString();

      const result: JobResult = {
        kind: "share-content-import",
        title: job.title,
        summary: `已从${adapter.displayName}导入视频并保存到"${folder.name}"文件夹。`,
        artifacts: [
          {
            id: assetId,
            name: `${sanitizedName}.mp4`,
            mimeType: "video/mp4",
            url: `/api/assets/${assetId}/content`,
            executionMode: "real",
            lineage: plan,
          },
        ],
        data: {
          values: { ...job.values, assetId, folderId: folder.id, folderName: folder.name },
          generatedAt: new Date().toISOString(),
          mock: false,
        },
      };

      // ── Success ───────────────────────────────────────────────
      stageComplete(job.id, "success", importStartMs, byteSize);

      context.change(job.id, {
        status: "succeeded",
        stage: "已保存到素材文件夹",
        progress: 100,
        provenance: plan,
        result,
        overallExecutionMode: "real",
      });

      if (accounts.taskNotificationsEnabled(job.ownerUserId)) {
        accounts.createNotification(
          job.ownerUserId,
          "task_completed",
          `${adapter.displayName}视频导入已完成`,
          `视频已保存到"${folder.name}"。`,
          job.id,
        );
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const retryable = err instanceof DouyinDownloadError ? err.retryable : false;
      const assetCreateFailed = err instanceof AssetCreateError;

      // ── Failure log ───────────────────────────────────────────
      const sanitized = sanitizeError(err);
      logFailure(job.id, "failure", importStartMs, sanitized.code, sanitized.summary);

      // ── Clean up orphaned artifacts ───────────────────────────
      if (destPath) await rm(destPath, { force: true }).catch(() => {});
      if (tosUploaded && storageKey && tosConfigured) {
        const delFn2 = context.tosDeleteFn ?? ((key: string) => ossutils.deleteObject(key));
        await delFn2(storageKey).catch(() => {});
      }
      if (storageKey) {
        store.scheduleObjectCleanup(job.id, storageKey, err);
      }

      context.change(job.id, {
        status: "failed",
        stage: assetCreateFailed ? "素材入库失败" : err instanceof DouyinDownloadError ? err.reason : "下载失败",
        error: {
          code: assetCreateFailed
            ? "ASSET_CREATE_FAILED"
            : err instanceof DouyinDownloadError
              ? err.reason.toUpperCase()
              : "DOWNLOAD_FAILED",
          message: errorMessage,
          retryable,
          requestId: crypto.randomUUID(),
        },
      });

      if (accounts?.taskNotificationsEnabled(job.ownerUserId)) {
        accounts.createNotification(
          job.ownerUserId,
          "task_failed",
          `${adapter.displayName}视频导入失败`,
          errorMessage.slice(0, 500),
          job.id,
        );
      }
    } finally {
      // ── Cleanup ───────────────────────────────────────────────
      const cleanupStart = stageStart();
      if (downloadResult) cleanupDownloadDir(downloadResult.tempDir);
      emitLog({
        jobId: job.id,
        stage: "cleanup",
        result: "ok",
        durationMs: Date.now() - cleanupStart,
        errorSummary: downloadResult ? "temp dir cleaned" : "no temp dir",
      });
    }
  },
};
