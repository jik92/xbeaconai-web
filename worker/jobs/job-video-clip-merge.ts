import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, relative, resolve } from "node:path";
import { env } from "../../server/env";
import { concatVideos, probeMedia } from "../../server/media/ffmpeg";
import { ossutils } from "../../server/storage/ossutils";
import type { StageProvenance } from "../../server/types";
import type { WorkerJobHandler } from "./types";
import { assetIdsFromValues } from "./utils";

export const videoClipMergeJob: WorkerJobHandler = {
  name: "video-clip-merge",
  supports: (job) => job.moduleId === "video-cut" && job.values.mergeMode === "video-cut-clips",
  async execute(job, context) {
    const { accounts } = context;
    if (!accounts) throw new Error("素材所有权服务不可用");
    if (!ossutils.configured) throw new Error("TOS_NOT_CONFIGURED: 合并视频必须保存到素材文件夹");
    const assetIds = assetIdsFromValues(job.values);
    if (assetIds.length < 2) throw new Error("至少需要选择两个视频片段");
    const assets = assetIds.map((id) => accounts.getOwnedAsset(job.ownerUserId, id));
    if (assets.some((asset) => !asset?.mimeType.startsWith("video/")))
      throw new Error("合并素材不存在、不属于当前账号或不是视频");
    const folderId = job.values.outputFolderId;
    const folder = folderId ? accounts.getAssetFolder(job.ownerUserId, folderId) : undefined;
    if (!folder) throw new Error("保存文件夹不存在或不属于当前账号");

    const stage: StageProvenance = {
      id: `${job.id}:concat`,
      capability: "video-concat",
      executionMode: "local",
      implementation: "ffmpeg-concat",
      startedAt: new Date().toISOString(),
    };
    context.change(job.id, {
      status: "processing",
      stage: "正在读取所选片段",
      progress: 5,
      executionPlan: [stage],
      provenance: [stage],
      overallExecutionMode: "local",
    });

    const tempDir = await mkdtemp(resolve(tmpdir(), "yaozuo-video-merge-"));
    try {
      const uploadRoot = resolve(env.dataDir, "uploads");
      const inputPaths: string[] = [];
      for (const [index, asset] of assets.entries()) {
        if (!asset) throw new Error("合并素材不存在");
        const localPath = resolve(uploadRoot, asset.storageKey);
        const local = relative(uploadRoot, localPath);
        const inputPath =
          local && !local.startsWith("..") && !local.startsWith("/") && existsSync(localPath)
            ? localPath
            : resolve(tempDir, `input-${String(index + 1).padStart(3, "0")}${extname(asset.originalName) || ".mp4"}`);
        if (inputPath !== localPath) await ossutils.downloadLibraryFile(asset.storageKey, inputPath);
        const media = await probeMedia(inputPath);
        if (!media.streams.some((stream) => stream.codec_type === "video"))
          throw new Error(`${asset.originalName} 无法解码`);
        inputPaths.push(inputPath);
        context.change(job.id, {
          stage: `正在读取片段 ${index + 1}/${assets.length}`,
          progress: Math.round(5 + ((index + 1) / assets.length) * 30),
        });
      }

      const outputPath = resolve(tempDir, "merged.mp4");
      context.change(job.id, { stage: "正在按原始切片顺序合并", progress: 45 });
      await concatVideos(inputPaths, outputPath);
      const media = await probeMedia(outputPath);
      const video = media.streams.find((stream) => stream.codec_type === "video");
      const output = Bun.file(outputPath);
      const safeTitle = job.title.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 80) || "合并视频";
      const fileName = `${safeTitle}.mp4`;
      const assetId = crypto.randomUUID();
      const storageKey = `${folder.storagePrefix}generated/${job.id}/${fileName}`;
      context.change(job.id, { stage: "正在保存合并视频", progress: 80 });
      await ossutils.putLibraryFile({
        filePath: outputPath,
        key: storageKey,
        mimeType: "video/mp4",
        sizeBytes: output.size,
      });
      accounts.createAsset({
        id: assetId,
        ownerUserId: job.ownerUserId,
        storageKey,
        originalName: fileName,
        mimeType: "video/mp4",
        byteSize: output.size,
        width: video?.width,
        height: video?.height,
        durationSec: Number(media.format.duration ?? 0) || undefined,
        kind: "media",
        displayName: safeTitle,
        description: `由 ${assets.length} 个切片按原始顺序合并`,
        folderId: folder.id,
        createdAt: new Date().toISOString(),
      });
      stage.completedAt = new Date().toISOString();
      context.change(job.id, {
        status: "succeeded",
        stage: "合并视频已保存到素材库",
        progress: 100,
        provenance: [stage],
        result: {
          kind: "video-merge",
          title: job.title,
          summary: `已按原始顺序合并 ${assets.length} 个切片并保存到“${folder.name}”文件夹。`,
          artifacts: [
            {
              id: assetId,
              name: fileName,
              mimeType: "video/mp4",
              url: `/api/assets/${assetId}/content`,
              executionMode: "local",
              lineage: [stage],
            },
          ],
          data: {
            values: { ...job.values, outputFolderId: folder.id, mergedClipCount: String(assets.length) },
            generatedAt: new Date().toISOString(),
            mock: false,
          },
        },
        overallExecutionMode: "local",
      });
      if (accounts.taskNotificationsEnabled(job.ownerUserId))
        accounts.createNotification(
          job.ownerUserId,
          "task_completed",
          "片段合并已完成",
          `${assets.length} 个切片已合并并保存到“${folder.name}”。`,
          job.id,
        );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  },
};
