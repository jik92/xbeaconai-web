import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { env } from "../../server/env";
import { extractCompressedAudio, normalizeReferenceImage, probeMedia } from "../../server/media/ffmpeg";
import { analyzeVideoWithGemini, transcribeMediaWithAihubmix } from "../../server/providers/gemini-video-analysis";
import { ossutils } from "../../server/storage/ossutils";
import type { JobResult, StageProvenance } from "../../server/types";
import { parseRemixSources, type RemixAnalysisEntry, type RemixSourceRef } from "../../shared/video-remix/workflow";
import { buildVideoAnalysisPrompt } from "../../web/features/video-remix/video-analysis-prompt";
import type { WorkerJobHandler } from "./types";
import { materializeRemixReferenceAssets, materializeRemixVideoAsset } from "./video-remix-assets";

function legacySource(value: string | undefined): RemixSourceRef[] {
  const assetId = value?.split(":", 3)[1];
  if (!assetId) return [];
  return [{ assetId, name: value?.split(":").slice(2).join(":") || "source.mp4" }];
}

export const videoRemixAnalysisJob: WorkerJobHandler = {
  name: "video-remix-analysis",
  supports: (job) => job.moduleId === "video-remix" && job.values.workflowPhase === "analysis",
  async execute(job, context) {
    const { accounts } = context;
    const provenance: StageProvenance[] = [];
    let taskTempDir: string | undefined;
    try {
      if (!accounts) throw new Error("素材所有权服务不可用");
      const sources = parseRemixSources(job.values.sources);
      const sourceRefs = sources.length ? sources : legacySource(job.values.source);
      if (!sourceRefs.length) throw new Error("视频素材标识无效");
      const sourceAssets = sourceRefs.map((source) => accounts.getOwnedAsset(job.ownerUserId, source.assetId));
      if (sourceAssets.some((asset) => !asset?.mimeType.startsWith("video/")))
        throw new Error("视频素材不存在或不属于当前账号");

      let productImageIds: string[] = [];
      try {
        const parsedIds = JSON.parse(job.values.productImageAssetIds || "[]");
        if (Array.isArray(parsedIds)) productImageIds = parsedIds.filter((id): id is string => typeof id === "string");
      } catch {
        throw new Error("商品参考图配置无效");
      }
      const referenceAssets = productImageIds.map((id) => accounts.getOwnedAsset(job.ownerUserId, id));
      if (!referenceAssets.length || referenceAssets.some((reference) => !reference?.mimeType.startsWith("image/")))
        throw new Error("商品参考图不存在或不属于当前账号");

      taskTempDir = await mkdtemp(resolve(tmpdir(), "yaozuo-remix-analysis-"));
      const uploadRoot = resolve(env.dataDir, "uploads");
      const referencePaths = await materializeRemixReferenceAssets({
        uploadRoot,
        tempDir: taskTempDir,
        referenceAssets: referenceAssets.filter((reference) => reference !== undefined),
        tosConfigured: ossutils.configured,
        download: (storageKey, filePath) => ossutils.downloadLibraryFile(storageKey, filePath),
      });
      const productImages = await Promise.all(
        referencePaths.map(async (inputPath, index) => {
          const outputPath = resolve(taskTempDir || "", `product-normalized-${index + 1}.jpg`);
          await normalizeReferenceImage(inputPath, outputPath);
          return { path: outputPath, mimeType: "image/jpeg" };
        }),
      );

      const entries: RemixAnalysisEntry[] = [];
      const artifacts: JobResult["artifacts"] = [];
      context.change(job.id, {
        status: "processing",
        stage: `准备解析 ${sourceRefs.length} 条分镜视频`,
        progress: 3,
        overallExecutionMode: "real",
      });

      for (const [index, source] of sourceRefs.entries()) {
        const latest = context.store.get(job.id);
        if (!latest || latest.cancelRequested) {
          context.change(job.id, { status: "cancelled", stage: "已取消", progress: latest?.progress ?? 0 });
          return;
        }
        const asset = sourceAssets[index];
        if (!asset) continue;
        const sourceDir = resolve(taskTempDir, `source-${index + 1}`);
        await mkdir(sourceDir, { recursive: true });
        const progress = (fraction: number) => Math.round(5 + ((index + fraction) / sourceRefs.length) * 90);
        const sourceLineage: StageProvenance[] = [];
        try {
          const videoPath = await materializeRemixVideoAsset({
            uploadRoot,
            tempDir: sourceDir,
            videoAsset: asset,
            tosConfigured: ossutils.configured,
            download: (storageKey, filePath) => ossutils.downloadLibraryFile(storageKey, filePath),
          });
          const probeStage: StageProvenance = {
            id: `${job.id}:${source.assetId}:probe`,
            capability: "media-probe",
            executionMode: "local",
            implementation: "ffprobe-local",
            startedAt: new Date().toISOString(),
          };
          context.change(job.id, {
            stage: `分析视频结构 ${index + 1}/${sourceRefs.length}`,
            progress: progress(0.15),
            provenance: [...provenance, probeStage],
          });
          const media = await probeMedia(videoPath);
          const durationSeconds = Number(media.format.duration ?? 0);
          probeStage.completedAt = new Date().toISOString();
          sourceLineage.push(probeStage);

          const transcriptionStage: StageProvenance = {
            id: `${job.id}:${source.assetId}:transcription`,
            capability: "speech-transcribe",
            executionMode: "real",
            implementation: "aihubmix-transcription",
            provider: "aihubmix",
            model: "gpt-4o-transcribe-diarize",
            startedAt: new Date().toISOString(),
          };
          context.change(job.id, {
            stage: `识别原声口播 ${index + 1}/${sourceRefs.length}`,
            progress: progress(0.35),
            provenance: [...provenance, ...sourceLineage, transcriptionStage],
          });
          let transcript = "";
          try {
            const audioPath = resolve(sourceDir, "source.mp3");
            await extractCompressedAudio(videoPath, audioPath);
            transcript = (await transcribeMediaWithAihubmix({ mediaPath: audioPath, mimeType: "audio/mpeg" })).text;
          } catch (error) {
            transcriptionStage.fallbackReason = `独立转写不可用，改由视频模型直接理解原声：${error instanceof Error ? error.message.slice(0, 160) : "未知错误"}`;
          }
          transcriptionStage.completedAt = new Date().toISOString();
          sourceLineage.push(transcriptionStage);

          const analysisStage: StageProvenance = {
            id: `${job.id}:${source.assetId}:video-analysis`,
            capability: "video-understand",
            executionMode: "real",
            implementation: "gemini-video-analysis",
            provider: "aihubmix",
            model: env.videoAnalysisModel,
            startedAt: new Date().toISOString(),
          };
          context.change(job.id, {
            stage: `生成分镜提示词 ${index + 1}/${sourceRefs.length}`,
            progress: progress(0.65),
            provenance: [...provenance, ...sourceLineage, analysisStage],
          });
          const prompt = buildVideoAnalysisPrompt({
            durationSeconds,
            speechTranscript: transcript,
            productName: job.values.productName,
            productImageCount: productImages.length,
            demand: job.values.description,
          });
          const analysis = await analyzeVideoWithGemini({
            videoPath,
            prompt,
            model: env.videoAnalysisModel,
            productImages,
          });
          analysisStage.completedAt = new Date().toISOString();
          sourceLineage.push(analysisStage);
          provenance.push(...sourceLineage);
          entries.push({ ...source, status: "succeeded", prompt: analysis.text, transcript });
          artifacts.push({
            id: `${job.id}:${source.assetId}:analysis`,
            name: `${source.name}.analysis.md`,
            mimeType: "text/markdown",
            text: analysis.text,
            executionMode: "real",
            lineage: sourceLineage,
          });
          context.change(job.id, {
            stage: `已解析 ${index + 1}/${sourceRefs.length}`,
            progress: progress(1),
            values: { ...job.values, analysisEntries: JSON.stringify(entries) },
            provenance,
          });
        } catch (error) {
          entries.push({
            ...source,
            status: "failed",
            error: error instanceof Error ? error.message : "视频解析失败",
          });
          provenance.push(...sourceLineage);
          context.change(job.id, {
            stage: `第 ${index + 1} 条解析失败，继续处理`,
            progress: progress(1),
            values: { ...job.values, analysisEntries: JSON.stringify(entries) },
            provenance,
          });
        }
      }

      const succeeded = entries.filter((entry) => entry.status === "succeeded");
      const failed = entries.length - succeeded.length;
      const values = {
        ...job.values,
        analysisEntries: JSON.stringify(entries),
        analysisPrompt: succeeded[0]?.prompt ?? "",
        transcript: succeeded[0]?.transcript ?? "",
      };
      const result: JobResult = {
        kind: "video-remix-analysis",
        title: job.title,
        summary: failed
          ? `已完成 ${succeeded.length}/${entries.length} 条视频解析，${failed} 条失败。`
          : `已完成 ${succeeded.length} 条视频的独立解析。`,
        artifacts,
        data: { values, generatedAt: new Date().toISOString(), mock: false },
      };
      if (!succeeded.length) {
        context.change(job.id, {
          status: "failed",
          stage: "全部视频解析失败",
          progress: 100,
          values,
          provenance,
          result,
          error: {
            code: "VIDEO_ANALYSIS_FAILED",
            message: entries[0]?.error || "全部视频解析失败",
            retryable: true,
            requestId: crypto.randomUUID(),
          },
        });
        return;
      }
      context.change(job.id, {
        status: failed ? "partially_succeeded" : "succeeded",
        stage: failed ? "部分视频解析完成" : "全部提示词已生成",
        progress: 100,
        values,
        provenance,
        result,
        overallExecutionMode: "real",
      });
    } catch (error) {
      context.change(job.id, {
        status: "failed",
        stage: "AI 解析失败",
        provenance,
        error: {
          code: "VIDEO_ANALYSIS_FAILED",
          message: error instanceof Error ? error.message : "视频解析失败",
          retryable: true,
          requestId: crypto.randomUUID(),
        },
      });
    } finally {
      if (taskTempDir) await rm(taskTempDir, { recursive: true, force: true });
    }
  },
};
