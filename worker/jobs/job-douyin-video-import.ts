import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { env } from "../../server/env";
import { cleanupDownloadDir, DouyinDownloadError } from "../../server/imports/douyin-video";
import { platformAdapters, ShareContentParser } from "../../server/imports/share-content";
import { probeMedia } from "../../server/media/ffmpeg";
import { ossutils } from "../../server/storage/ossutils";
import type { JobResult, StageProvenance } from "../../server/types";
import type { WorkerJobHandler } from "./types";

const shareParser = new ShareContentParser(platformAdapters);

export const douyinVideoImportJob: WorkerJobHandler = {
  name: "share-content-import",
  supports: (job) => job.moduleId === "douyin-video-import" || job.moduleId === "share-content-import",
  async execute(job, context) {
    const { accounts, store } = context;
    if (!accounts) throw new Error("素材所有权服务不可用");

    const folderId = job.values.folderId;
    if (!folderId) throw new Error("缺少目标文件夹");
    const folder = accounts.getAssetFolder(job.ownerUserId, folderId);
    if (!folder) throw new Error("目标文件夹不存在或不属于当前账号");

    // Resolve the normalized URL — support both old and new job schemas
    const platformId = job.values.platformId ?? "douyin";
    const normalizedUrl = job.values.normalizedUrl ?? job.values.shareUrl;
    if (!normalizedUrl) throw new Error("缺少分享链接");

    const adapter = shareParser.adapterFor(platformId);
    if (!adapter) throw new Error(`不支持的平台: ${platformId}`);

    if (!adapter.supportsDownload) {
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

    try {
      // Cancel check
      const precheck = store.get(job.id);
      if (!precheck || precheck.cancelRequested) {
        context.change(job.id, { status: "cancelled", stage: "已取消" });
        return;
      }

      // Use injectable download function if provided (integration testing),
      // otherwise use the real platform adapter.
      const isMocked = !!context.downloadFn;
      if (context.downloadFn) {
        downloadResult = await context.downloadFn(platformId, normalizedUrl);
      } else {
        downloadResult = await adapter.download(normalizedUrl);
      }

      // Cancel check after download
      const midcheck = store.get(job.id);
      if (!midcheck || midcheck.cancelRequested) {
        context.change(job.id, { status: "cancelled", stage: "已取消" });
        return;
      }

      // Verify downloaded file is a valid video (mandatory in production, skipped for mocked downloads)
      if (!isMocked) {
        context.change(job.id, { stage: "正在验证视频", progress: 50 });
        let probe: Awaited<ReturnType<typeof probeMedia>>;
        try {
          probe = await probeMedia(downloadResult.filePath);
        } catch (probeErr) {
          throw new DouyinDownloadError(
            `视频验证失败：ffprobe 不可用或无法解析文件 (${probeErr instanceof Error ? probeErr.message : String(probeErr)})`,
            true,
            "config_error",
          );
        }
        const hasVideo = probe.streams.some((s) => s.codec_type === "video");
        if (!hasVideo) {
          throw new DouyinDownloadError(
            "下载的文件不包含视频流，可能不是有效视频",
            false,
            "download_failed",
          );
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

      mkdirSync(dirname(destPath), { recursive: true, mode: 0o700 });
      await Bun.write(destPath, file);

      if (ossutils.configured) {
        await ossutils.putLibraryFile({
          filePath: downloadResult.filePath,
          key: storageKey,
          mimeType: "video/mp4",
          sizeBytes: byteSize,
        });
      }

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
          values: {
            ...job.values,
            assetId,
            folderId: folder.id,
            folderName: folder.name,
          },
          generatedAt: new Date().toISOString(),
          mock: false,
        },
      };

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

      if (destPath) await rm(destPath, { force: true }).catch(() => {});
      if (storageKey && ossutils.configured) {
        await ossutils.deleteObject(storageKey).catch(() => {});
      }
      if (storageKey) {
        store.scheduleObjectCleanup(job.id, storageKey, err);
      }

      context.change(job.id, {
        status: "failed",
        stage: err instanceof DouyinDownloadError ? err.reason : "下载失败",
        error: {
          code: err instanceof DouyinDownloadError ? err.reason.toUpperCase() : "DOWNLOAD_FAILED",
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
      if (downloadResult) cleanupDownloadDir(downloadResult.tempDir);
    }
  },
};
