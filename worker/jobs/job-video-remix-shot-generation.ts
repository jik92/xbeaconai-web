import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { probeMedia } from "../../server/media/ffmpeg";
import { isSeedanceModelId } from "../../server/models/video-models";
import { ossutils } from "../../server/storage/ossutils";
import type { StageProvenance } from "../../server/types";
import { SeedanceFlowError, SeedanceVideoJob } from "./job-seedance-video";
import type { WorkerJobHandler } from "./types";

export const videoRemixShotGenerationJob: WorkerJobHandler = {
  name: "video-remix-shot-generation",
  supports: (job) => job.moduleId === "video-remix" && job.values.workflowPhase === "shot-generation",
  async execute(job, context) {
    const { accounts } = context;
    if (!accounts) throw new Error("素材所有权服务不可用");
    if (!ossutils.configured) throw new Error("TOS_NOT_CONFIGURED: 分镜生成结果必须保存到素材库");
    if (!isSeedanceModelId(job.videoModel)) throw new Error("分镜生成模型无效");
    const sourceAsset = accounts.getOwnedAsset(job.ownerUserId, job.values.sourceAssetId || "");
    if (!sourceAsset?.mimeType.startsWith("video/")) throw new Error("原分镜素材不存在或不属于当前账号");
    const folder = accounts.getAssetFolder(job.ownerUserId, job.values.outputFolderId || "");
    if (!folder) throw new Error("保存文件夹不存在或不属于当前账号");

    const stage: StageProvenance = {
      id: `${job.id}:video-generate`,
      capability: "video-generate",
      executionMode: job.overallExecutionMode === "mock" ? "mock" : "real",
      implementation: job.overallExecutionMode === "mock" ? "ffmpeg-seedance-mock" : "aihubmix-video",
      provider: job.overallExecutionMode === "mock" ? undefined : "aihubmix",
      model: job.overallExecutionMode === "mock" ? undefined : job.videoModel,
      startedAt: new Date().toISOString(),
    };
    context.change(job.id, {
      status: "processing",
      stage: "正在生成当前分镜",
      progress: 8,
      provenance: [stage],
      overallExecutionMode: job.overallExecutionMode === "mock" ? "mock" : "real",
    });

    const tempDir = await mkdtemp(resolve(tmpdir(), "yaozuo-remix-shot-"));
    try {
      const generated = await new SeedanceVideoJob(context).execute(job, job.videoModel);
      if (context.store.get(job.id)?.cancelRequested) {
        context.change(job.id, { status: "cancelled", stage: "已取消" });
        return;
      }
      stage.executionMode = generated.executionMode;
      stage.implementation = generated.implementation;
      stage.provider = generated.executionMode === "real" ? "aihubmix" : undefined;
      stage.model = generated.executionMode === "real" ? job.videoModel : undefined;
      const outputPath = resolve(tempDir, "generated-shot.mp4");
      await Bun.write(outputPath, generated.bytes);
      const media = await probeMedia(outputPath);
      const video = media.streams.find((stream) => stream.codec_type === "video");
      if (!video) throw new Error("生成结果不包含可解码视频");
      const output = Bun.file(outputPath);
      const safeSourceName = sourceAsset.originalName.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}._-]+/gu, "-");
      const fileName = `${safeSourceName || "分镜"}-生成-${job.id.slice(0, 8)}.mp4`;
      const assetId = crypto.randomUUID();
      const storageKey = `${folder.storagePrefix}generated/${job.id}/${fileName}`;
      context.change(job.id, { stage: "正在保存生成分镜", progress: 82 });
      await ossutils.putLibraryFile({
        filePath: outputPath,
        key: storageKey,
        mimeType: "video/mp4",
        sizeBytes: output.size,
        onProgress: (percent) =>
          context.change(job.id, { stage: "正在保存生成分镜", progress: Math.round(82 + percent * 16) }),
      });
      accounts.createAsset({
        id: assetId,
        ownerUserId: job.ownerUserId,
        storageKey,
        originalName: fileName,
        mimeType: "video/mp4",
        byteSize: output.size,
        width: video.width,
        height: video.height,
        durationSec: Number(media.format.duration ?? 0) || undefined,
        kind: "media",
        displayName: fileName.replace(/\.mp4$/, ""),
        description: `由爆款二创任务 ${job.parentJobId || job.id} 的分镜 ${sourceAsset.id} 生成`,
        folderId: folder.id,
        createdAt: new Date().toISOString(),
      });
      stage.completedAt = new Date().toISOString();
      const result = {
        kind: "video-remix-shot-generation",
        title: job.title,
        summary: `当前分镜已生成并保存到“${folder.name}”。`,
        artifacts: [
          {
            id: assetId,
            name: fileName,
            mimeType: "video/mp4",
            url: `/api/assets/${assetId}/content`,
            executionMode: generated.executionMode,
            lineage: [stage],
          },
        ],
        data: {
          values: { ...job.values, generatedAssetId: assetId },
          generatedAt: new Date().toISOString(),
          mock: generated.executionMode === "mock",
        },
      };
      context.change(job.id, {
        status: "succeeded",
        stage: "当前分镜视频已生成",
        progress: 100,
        provenance: [stage],
        result,
        overallExecutionMode: generated.executionMode,
      });
      if (accounts.taskNotificationsEnabled(job.ownerUserId))
        accounts.createNotification(
          job.ownerUserId,
          "task_completed",
          "爆款二创分镜生成完成",
          `${sourceAsset.originalName} 的生成视频已保存到“${folder.name}”。`,
          job.id,
        );
    } catch (error) {
      if (error instanceof SeedanceFlowError && error.code === "JOB_CANCELLED") {
        context.change(job.id, { status: "cancelled", stage: "已取消", error: undefined });
        return;
      }
      throw error;
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  },
};
