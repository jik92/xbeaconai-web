import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { env } from "../../server/env";
import { concatVideos, normalizeMashupVideo, probeMedia } from "../../server/media/ffmpeg";
import { ossutils } from "../../server/storage/ossutils";
import type { StageProvenance } from "../../server/types";
import type { WorkerJobHandler } from "./types";
import { materializeRemixVideoAsset } from "./video-remix-assets";

function orderedAssetIds(raw: string | undefined) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export const videoRemixComposeJob: WorkerJobHandler = {
  name: "video-remix-compose",
  supports: (job) => job.moduleId === "video-remix" && job.values.workflowPhase === "compose",
  async execute(job, context) {
    const { accounts } = context;
    if (!accounts) throw new Error("素材所有权服务不可用");
    if (!ossutils.configured) throw new Error("TOS_NOT_CONFIGURED: 合并成片必须保存到素材库");
    const assetIds = orderedAssetIds(job.values.orderedAssetIds);
    if (assetIds.length < 2) throw new Error("合并成片至少需要两个视频");
    const assets = assetIds.map((assetId) => accounts.getOwnedAsset(job.ownerUserId, assetId));
    if (assets.some((asset) => !asset?.mimeType.startsWith("video/")))
      throw new Error("合并素材不存在、不属于当前账号或不是视频");
    const folder = accounts.getAssetFolder(job.ownerUserId, job.values.outputFolderId || "");
    if (!folder) throw new Error("保存文件夹不存在或不属于当前账号");

    const normalizeStage: StageProvenance = {
      id: `${job.id}:normalize`,
      capability: "video-normalize",
      executionMode: "local",
      implementation: "ffmpeg-local",
      startedAt: new Date().toISOString(),
    };
    const concatStage: StageProvenance = {
      id: `${job.id}:concat`,
      capability: "video-concat",
      executionMode: "local",
      implementation: "ffmpeg-concat",
      startedAt: "",
    };
    context.change(job.id, {
      status: "processing",
      stage: "正在读取分镜视频",
      progress: 5,
      provenance: [normalizeStage],
      overallExecutionMode: "local",
    });

    const tempDir = await mkdtemp(resolve(tmpdir(), "yaozuo-remix-compose-"));
    try {
      const uploadRoot = resolve(env.dataDir, "uploads");
      const prepared: Array<{ path: string; hasAudio: boolean; width?: number; height?: number }> = [];
      for (const [index, asset] of assets.entries()) {
        if (!asset) throw new Error("合并素材不存在");
        if (context.store.get(job.id)?.cancelRequested) {
          context.change(job.id, { status: "cancelled", stage: "已取消", progress: job.progress });
          return;
        }
        const sourceDir = resolve(tempDir, `source-${index + 1}`);
        await mkdir(sourceDir, { recursive: true });
        const path = await materializeRemixVideoAsset({
          uploadRoot,
          tempDir: sourceDir,
          videoAsset: asset,
          tosConfigured: ossutils.configured,
          download: (storageKey, filePath) => ossutils.downloadLibraryFile(storageKey, filePath),
        });
        const media = await probeMedia(path);
        const video = media.streams.find((stream) => stream.codec_type === "video");
        if (!video) throw new Error(`${asset.originalName} 无法解码`);
        prepared.push({
          path,
          hasAudio: media.streams.some((stream) => stream.codec_type === "audio"),
          width: video.width,
          height: video.height,
        });
        context.change(job.id, {
          stage: `正在读取视频 ${index + 1}/${assets.length}`,
          progress: Math.round(5 + ((index + 1) / assets.length) * 20),
        });
      }
      const first = prepared[0];
      if (!first) throw new Error("没有可合并的视频");
      const width = Math.max(2, Math.floor((first.width || 720) / 2) * 2);
      const height = Math.max(2, Math.floor((first.height || 1280) / 2) * 2);
      const normalized: string[] = [];
      for (const [index, input] of prepared.entries()) {
        const output = resolve(tempDir, `normalized-${String(index + 1).padStart(3, "0")}.mp4`);
        await normalizeMashupVideo({ source: input.path, output, width, height, hasAudio: input.hasAudio });
        normalized.push(output);
        context.change(job.id, {
          stage: `正在标准化视频 ${index + 1}/${prepared.length}`,
          progress: Math.round(25 + ((index + 1) / prepared.length) * 35),
        });
      }
      normalizeStage.completedAt = new Date().toISOString();
      concatStage.startedAt = new Date().toISOString();
      context.change(job.id, {
        stage: "正在按时间线顺序合并",
        progress: 65,
        provenance: [normalizeStage, concatStage],
      });
      const outputPath = resolve(tempDir, "remix-composed.mp4");
      await concatVideos(normalized, outputPath);
      const media = await probeMedia(outputPath);
      const video = media.streams.find((stream) => stream.codec_type === "video");
      const output = Bun.file(outputPath);
      const safeTitle = job.title.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 80) || "爆款二创合并成片";
      const fileName = `${safeTitle}.mp4`;
      const assetId = crypto.randomUUID();
      const storageKey = `${folder.storagePrefix}generated/${job.id}/${fileName}`;
      context.change(job.id, { stage: "正在保存合并成片", progress: 82 });
      await ossutils.putLibraryFile({
        filePath: outputPath,
        key: storageKey,
        mimeType: "video/mp4",
        sizeBytes: output.size,
        onProgress: (percent) =>
          context.change(job.id, { stage: "正在保存合并成片", progress: Math.round(82 + percent * 16) }),
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
        description: `由爆款二创任务 ${job.id} 按用户时间线顺序合并`,
        folderId: folder.id,
        createdAt: new Date().toISOString(),
      });
      concatStage.completedAt = new Date().toISOString();
      context.change(job.id, {
        status: "succeeded",
        stage: "合并成片已保存到素材库",
        progress: 100,
        provenance: [normalizeStage, concatStage],
        result: {
          kind: "video-remix-compose",
          title: job.title,
          summary: `已按时间线顺序合并 ${assets.length} 个视频并保存到“${folder.name}”。`,
          artifacts: [
            {
              id: assetId,
              name: fileName,
              mimeType: "video/mp4",
              url: `/api/assets/${assetId}/content`,
              executionMode: "local",
              lineage: [normalizeStage, concatStage],
            },
          ],
          data: {
            values: { ...job.values, mergedVideoCount: String(assets.length) },
            generatedAt: new Date().toISOString(),
            mock: false,
          },
        },
      });
      if (accounts.taskNotificationsEnabled(job.ownerUserId))
        accounts.createNotification(
          job.ownerUserId,
          "task_completed",
          "爆款二创合并完成",
          `${assets.length} 个视频已合并并保存到“${folder.name}”。`,
          job.id,
        );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  },
};
