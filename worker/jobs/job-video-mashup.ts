import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve } from "node:path";
import { concatMashupVideos, normalizeMashupVideo, probeMedia } from "../../server/media/ffmpeg";
import { ossutils } from "../../server/storage/ossutils";
import type { JobResult, StageProvenance } from "../../server/types";
import { parseVideoMashupConfig, planMashupCombinations } from "../../shared/video-mashup/config";
import type { WorkerJobHandler } from "./types";

export const videoMashupJob: WorkerJobHandler = {
  name: "video-mashup",
  supports: (job) => job.moduleId === "video-mashup" && job.values.mergeMode !== "video-cut-clips",
  async execute(job, context) {
    const { accounts } = context;
    if (!accounts) throw new Error("素材所有权服务不可用");
    if (!ossutils.configured) throw new Error("TOS_NOT_CONFIGURED: 视频混剪必须保存到私有 TOS");
    const config = parseVideoMashupConfig(job.values.config ?? "");
    const folder = accounts.getAssetFolder(job.ownerUserId, config.outputFolderId);
    if (!folder) throw new Error("保存文件夹不存在或不属于当前账号");
    const combinations = planMashupCombinations(config);
    if (!combinations.length) throw new Error("混剪没有可用组合");
    const uniqueAssetIds = [...new Set(config.groups.flatMap((group) => group.assetIds))];
    const assets = new Map(
      uniqueAssetIds.map((assetId) => {
        const asset = accounts.getOwnedAsset(job.ownerUserId, assetId);
        if (!asset?.mimeType.startsWith("video/")) throw new Error("混剪素材不存在、不属于当前账号或不是视频");
        return [assetId, asset] as const;
      }),
    );
    const completedKeys = new Set<string>();
    try {
      const saved = job.result?.data?.values.completedCombinationKeys;
      if (saved) for (const key of JSON.parse(saved) as string[]) completedKeys.add(key);
    } catch {
      // Invalid historic progress is ignored and rebuilt from this run.
    }
    const artifacts: JobResult["artifacts"] = [...(job.result?.artifacts ?? [])];
    const failed: Array<{ key: string; message: string }> = [];
    const tempDir = await mkdtemp(resolve(tmpdir(), "yaozuo-video-mashup-"));
    const plan: StageProvenance[] = [
      {
        id: `${job.id}:prepare`,
        capability: "asset-normalize",
        executionMode: "local",
        implementation: "ffmpeg-local",
        startedAt: new Date().toISOString(),
      },
      {
        id: `${job.id}:render`,
        capability: "batch-render",
        executionMode: "local",
        implementation: "ffmpeg-local",
        startedAt: "",
      },
    ];
    const prepareStage = plan[0];
    const renderStage = plan[1];
    if (!prepareStage || !renderStage) throw new Error("混剪执行计划初始化失败");
    try {
      context.change(job.id, {
        status: "processing",
        stage: "正在准备混剪素材",
        progress: 5,
        executionPlan: plan,
        provenance: [prepareStage],
        overallExecutionMode: "local",
      });
      const normalized = new Map<string, string>();
      const normalizationErrors = new Map<string, string>();
      const { width, height } =
        config.resolution === "1080P" ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
      for (const [index, assetId] of uniqueAssetIds.entries()) {
        const latest = context.store.get(job.id);
        if (!latest || latest.cancelRequested) {
          context.change(job.id, { status: "cancelled", stage: "已取消", progress: latest?.progress ?? 0 });
          return;
        }
        const asset = assets.get(assetId);
        if (!asset) throw new Error("混剪素材状态不一致");
        try {
          const source = resolve(tempDir, `source-${index}${extname(asset.originalName) || ".mp4"}`);
          if (!existsSync(source)) await ossutils.downloadLibraryFile(asset.storageKey, source);
          const media = await probeMedia(source);
          if (!media.streams.some((stream) => stream.codec_type === "video"))
            throw new Error(`素材“${asset.displayName}”不包含视频流`);
          const output = resolve(tempDir, `normalized-${index}.mp4`);
          await normalizeMashupVideo({
            source,
            output,
            width,
            height,
            hasAudio: media.streams.some((stream) => stream.codec_type === "audio"),
          });
          normalized.set(assetId, output);
        } catch (error) {
          if (context.store.get(job.id)?.cancelRequested) {
            context.change(job.id, { status: "cancelled", stage: "已取消", progress: latest.progress });
            return;
          }
          normalizationErrors.set(assetId, error instanceof Error ? error.message : "素材标准化失败");
        }
        context.change(job.id, {
          stage: `正在标准化素材 ${index + 1}/${uniqueAssetIds.length}`,
          progress: Math.round(8 + ((index + 1) / uniqueAssetIds.length) * 30),
        });
      }
      prepareStage.completedAt = new Date().toISOString();
      renderStage.startedAt = new Date().toISOString();
      context.change(job.id, { stage: "正在生成混剪组合", progress: 40, provenance: plan });
      for (const [index, combination] of combinations.entries()) {
        if (completedKeys.has(combination.key)) continue;
        const latest = context.store.get(job.id);
        if (!latest || latest.cancelRequested) {
          context.change(job.id, {
            status: "cancelled",
            stage: `已取消，保留 ${artifacts.length} 个成片`,
            progress: latest?.progress ?? 0,
            result: artifacts.length
              ? {
                  kind: "video-mashup",
                  title: job.title,
                  summary: `任务已取消，已保存 ${artifacts.length} 个成片。`,
                  artifacts,
                  data: {
                    values: { ...job.values, completedCombinationKeys: JSON.stringify([...completedKeys]) },
                    generatedAt: new Date().toISOString(),
                    mock: false,
                  },
                }
              : undefined,
          });
          return;
        }
        try {
          const invalidSourceId = combination.assetIds.find((assetId) => normalizationErrors.has(assetId));
          if (invalidSourceId) throw new Error(normalizationErrors.get(invalidSourceId) ?? "组合素材标准化失败");
          const outputPath = resolve(tempDir, `mashup-${String(index + 1).padStart(3, "0")}.mp4`);
          const inputPaths = combination.assetIds.map((assetId) => normalized.get(assetId));
          if (inputPaths.some((path) => !path)) throw new Error("混剪标准化素材缺失");
          await concatMashupVideos(inputPaths as string[], outputPath);
          const file = Bun.file(outputPath);
          const sequence = String(index + 1).padStart(3, "0");
          const safeTitle = job.title.replace(/[^\p{L}\p{N}._-]+/gu, "-") || "视频混剪";
          const fileName = `${safeTitle}_${sequence}.mp4`;
          const assetId = crypto.randomUUID();
          const storageKey = `${folder.storagePrefix}generated/${job.id}/${fileName}`;
          const uploadAbort = new AbortController();
          const cancellationTimer = setInterval(() => {
            if (context.store.get(job.id)?.cancelRequested) uploadAbort.abort();
          }, 500);
          try {
            await ossutils.putLibraryFile({
              filePath: outputPath,
              key: storageKey,
              mimeType: "video/mp4",
              sizeBytes: file.size,
              signal: uploadAbort.signal,
              onProgress: (percent) =>
                context.change(job.id, {
                  stage: `正在保存成片 ${index + 1}/${combinations.length} · ${Math.round(percent * 100)}%`,
                  progress: Math.min(98, Math.round(42 + ((index + percent) / combinations.length) * 55)),
                }),
            });
          } finally {
            clearInterval(cancellationTimer);
          }
          const media = await probeMedia(outputPath);
          const video = media.streams.find((stream) => stream.codec_type === "video");
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
            displayName: `${job.title}_${sequence}`,
            description: `由视频混剪任务 ${job.id} 的组合 ${combination.key} 创建`,
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
          completedKeys.add(combination.key);
          context.change(job.id, {
            stage: `已完成成片 ${index + 1}/${combinations.length}`,
            progress: Math.min(98, Math.round(42 + ((index + 1) / combinations.length) * 55)),
            result: {
              kind: "video-mashup",
              title: job.title,
              summary: `已完成 ${artifacts.length}/${combinations.length} 个混剪成片。`,
              artifacts,
              data: {
                values: { ...job.values, completedCombinationKeys: JSON.stringify([...completedKeys]) },
                generatedAt: new Date().toISOString(),
                mock: false,
              },
            },
          });
        } catch (error) {
          failed.push({ key: combination.key, message: error instanceof Error ? error.message : "组合生成失败" });
        }
      }
      renderStage.completedAt = new Date().toISOString();
      if (!artifacts.length) throw new Error(failed[0]?.message ?? "所有混剪组合均生成失败");
      const status = failed.length ? "partially_succeeded" : "succeeded";
      context.change(job.id, {
        status,
        stage: failed.length ? "部分成片生成完成" : "混剪批次已完成",
        progress: 100,
        provenance: plan,
        result: {
          kind: "video-mashup",
          title: job.title,
          summary: failed.length
            ? `成功 ${artifacts.length} 个，失败 ${failed.length} 个，已保存到“${folder.name}”。`
            : `已生成 ${artifacts.length} 个成片并保存到“${folder.name}”。`,
          artifacts,
          data: {
            values: {
              ...job.values,
              completedCombinationKeys: JSON.stringify([...completedKeys]),
              failedCombinations: JSON.stringify(failed),
            },
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
          "视频混剪已完成",
          failed.length
            ? `成功 ${artifacts.length} 个，失败 ${failed.length} 个。`
            : `${artifacts.length} 个成片已保存。`,
          job.id,
        );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  },
};
