import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, relative, resolve } from "node:path";
import { env } from "../../server/env";
import { probeMedia, splitFixed } from "../../server/media/ffmpeg";
import { ossutils } from "../../server/storage/ossutils";
import type { JobResult, StageProvenance } from "../../server/types";
import type { WorkerJobHandler } from "./types";

export const videoCutJob: WorkerJobHandler = {
  name: "video-cut",
  supports: (job) => job.moduleId === "video-cut" && job.values.mergeMode !== "video-cut-clips",
  async execute(job, context) {
    const { accounts, store } = context;
    if (!accounts) throw new Error("素材所有权服务不可用");
    if (!ossutils.configured) throw new Error("TOS_NOT_CONFIGURED: 视频切片必须保存到素材文件夹的 TOS 目录");
    const sourceAssetId = job.values.source?.split(":", 3)[1];
    if (!sourceAssetId) throw new Error("视频素材标识无效");
    const sourceAsset = accounts.getOwnedAsset(job.ownerUserId, sourceAssetId);
    if (!sourceAsset?.mimeType.startsWith("video/")) throw new Error("视频素材不存在或不属于当前账号");
    const folderId = job.values.outputFolderId;
    const folder = folderId ? accounts.getAssetFolder(job.ownerUserId, folderId) : undefined;
    if (!folder) throw new Error("保存文件夹不存在或不属于当前账号");

    const plan: StageProvenance[] = [
      {
        id: `${job.id}:probe`,
        capability: "media-probe",
        executionMode: "local",
        implementation: "ffprobe-local",
        startedAt: new Date().toISOString(),
      },
      {
        id: `${job.id}:split`,
        capability: "video-split",
        executionMode: "local",
        implementation: "ffmpeg-split",
        startedAt: "",
      },
    ];
    context.change(job.id, {
      status: "processing",
      stage: "读取源视频",
      progress: 5,
      executionPlan: plan,
      provenance: [plan[0]],
      overallExecutionMode: "local",
    });

    const tempDir = await mkdtemp(resolve(tmpdir(), "yaozuo-video-cut-"));
    try {
      const uploadRoot = resolve(env.dataDir, "uploads");
      const localSourcePath = resolve(uploadRoot, sourceAsset.storageKey);
      const local = relative(uploadRoot, localSourcePath);
      const sourcePath =
        local && !local.startsWith("..") && !local.startsWith("/") && existsSync(localSourcePath)
          ? localSourcePath
          : resolve(tempDir, `source${extname(sourceAsset.originalName) || ".mp4"}`);
      if (sourcePath !== localSourcePath) await ossutils.downloadLibraryFile(sourceAsset.storageKey, sourcePath);
      await probeMedia(sourcePath);
      plan[0].completedAt = new Date().toISOString();
      plan[1].startedAt = new Date().toISOString();
      context.change(job.id, { stage: "正在分割视频", progress: 20, provenance: [...plan] });

      await splitFixed(sourcePath, resolve(tempDir, "clip-%03d.mp4"));
      const clipPaths = (await readdir(tempDir))
        .filter((name) => /^clip-\d+\.mp4$/.test(name))
        .sort()
        .map((name) => resolve(tempDir, name));
      if (!clipPaths.length) throw new Error("视频分割没有生成有效片段");

      const originalBase = sourceAsset.originalName.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}._-]+/gu, "-");
      const artifacts: JobResult["artifacts"] = [];
      for (const [index, clipPath] of clipPaths.entries()) {
        const latest = store.get(job.id);
        if (!latest || latest.cancelRequested) {
          context.change(job.id, { status: "cancelled", stage: "已取消" });
          return;
        }
        const sequence = String(index + 1).padStart(3, "0");
        const fileName = `${originalBase || "video"}_切片_${sequence}.mp4`;
        const assetId = crypto.randomUUID();
        const storageKey = `${folder.storagePrefix}generated/${job.id}/${fileName}`;
        const file = Bun.file(clipPath);
        const media = await probeMedia(clipPath);
        const video = media.streams.find((stream) => stream.codec_type === "video");
        await ossutils.putLibraryFile({
          filePath: clipPath,
          key: storageKey,
          mimeType: "video/mp4",
          sizeBytes: file.size,
        });
        accounts.createAsset({
          id: assetId,
          ownerUserId: job.ownerUserId,
          storageKey,
          originalName: fileName,
          mimeType: "video/mp4",
          byteSize: file.size,
          width: video?.width,
          height: video?.height,
          durationSec: Number(media.format.duration ?? 0) || undefined,
          kind: "media",
          displayName: `${sourceAsset.displayName}_切片_${sequence}`,
          description: `由任务 ${job.title} 自动生成`,
          folderId: folder.id,
          createdAt: new Date().toISOString(),
        });
        artifacts.push({
          id: assetId,
          name: fileName,
          mimeType: "video/mp4",
          url: `/api/assets/${assetId}/content`,
          executionMode: "local",
          lineage: plan,
        });
        context.change(job.id, {
          stage: `正在保存切片 ${index + 1}/${clipPaths.length}`,
          progress: Math.round(25 + ((index + 1) / clipPaths.length) * 70),
        });
      }
      plan[1].completedAt = new Date().toISOString();
      context.change(job.id, {
        status: "succeeded",
        stage: "已保存到素材文件夹",
        progress: 100,
        provenance: plan,
        result: {
          kind: "video-cut",
          title: job.title,
          summary: `已生成 ${artifacts.length} 个切片并保存到“${folder.name}”文件夹。`,
          artifacts,
          data: {
            values: { ...job.values, outputFolderId: folder.id, clipCount: String(artifacts.length) },
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
          "视频分割已完成",
          `${artifacts.length} 个切片已保存到“${folder.name}”。`,
          job.id,
        );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  },
};
