import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { env } from "../../server/env";
import { extractCompressedAudio, normalizeReferenceImage, probeMedia } from "../../server/media/ffmpeg";
import { analyzeVideoWithGemini, transcribeMediaWithAihubmix } from "../../server/providers/gemini-video-analysis";
import { ossutils } from "../../server/storage/ossutils";
import type { JobResult, StageProvenance } from "../../server/types";
import { buildVideoAnalysisPrompt } from "../../web/features/video-remix/video-analysis-prompt";
import type { WorkerJobHandler } from "./types";
import { materializeRemixAnalysisAssets } from "./video-remix-assets";

export const videoRemixAnalysisJob: WorkerJobHandler = {
  name: "video-remix-analysis",
  supports: (job) => job.moduleId === "video-remix" && job.values.workflowPhase === "analysis",
  async execute(job, context) {
    const { accounts } = context;
    const startedAt = new Date().toISOString();
    const provenance: StageProvenance[] = [];
    let taskTempDir: string | undefined;
    try {
      if (!accounts) throw new Error("素材所有权服务不可用");
      const sourceAssetId = job.values.source?.split(":", 3)[1];
      if (!sourceAssetId) throw new Error("视频素材标识无效");
      const asset = accounts.getOwnedAsset(job.ownerUserId, sourceAssetId);
      if (!asset?.mimeType.startsWith("video/")) throw new Error("视频素材不存在或不属于当前账号");
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

      const tempDir = await mkdtemp(resolve(tmpdir(), "yaozuo-remix-analysis-"));
      taskTempDir = tempDir;
      const uploadRoot = resolve(env.dataDir, "uploads");
      const { videoPath, referencePaths } = await materializeRemixAnalysisAssets({
        uploadRoot,
        tempDir,
        videoAsset: asset,
        referenceAssets: referenceAssets.filter((reference) => reference !== undefined),
        tosConfigured: ossutils.configured,
        download: (storageKey, filePath) => ossutils.downloadLibraryFile(storageKey, filePath),
      });

      const probeStage: StageProvenance = {
        id: `${job.id}:probe`,
        capability: "media-probe",
        executionMode: "local",
        implementation: "ffprobe-local",
        startedAt,
      };
      context.change(job.id, { status: "processing", stage: "分析视频结构", progress: 10, provenance: [probeStage] });
      const media = await probeMedia(videoPath);
      const durationSeconds = Number(media.format.duration ?? 0);
      probeStage.completedAt = new Date().toISOString();
      provenance.push(probeStage);

      const transcriptionStage: StageProvenance = {
        id: `${job.id}:transcription`,
        capability: "speech-transcribe",
        executionMode: "real",
        implementation: "aihubmix-transcription",
        provider: "aihubmix",
        model: "gpt-4o-transcribe-diarize",
        startedAt: new Date().toISOString(),
      };
      context.change(job.id, { stage: "识别原声口播", progress: 30, provenance: [...provenance, transcriptionStage] });
      let transcript = "";
      try {
        const audioPath = resolve(tempDir, "source.mp3");
        await extractCompressedAudio(videoPath, audioPath);
        const transcription = await transcribeMediaWithAihubmix({ mediaPath: audioPath, mimeType: "audio/mpeg" });
        transcript = transcription.text;
      } catch (error) {
        transcriptionStage.fallbackReason = `独立转写不可用，改由视频模型直接理解原声：${error instanceof Error ? error.message.slice(0, 160) : "未知错误"}`;
      }
      transcriptionStage.completedAt = new Date().toISOString();
      provenance.push(transcriptionStage);

      const analysisStage: StageProvenance = {
        id: `${job.id}:video-analysis`,
        capability: "video-understand",
        executionMode: "real",
        implementation: "gemini-video-analysis",
        provider: "aihubmix",
        model: env.videoAnalysisModel,
        startedAt: new Date().toISOString(),
      };
      context.change(job.id, {
        stage: "生成分镜提示词",
        progress: 60,
        values: { ...job.values, transcript },
        provenance: [...provenance, analysisStage],
      });
      const productImages = await Promise.all(
        referencePaths.map(async (inputPath, index) => {
          const outputPath = resolve(tempDir, `product-normalized-${index + 1}.jpg`);
          await normalizeReferenceImage(inputPath, outputPath);
          return { path: outputPath, mimeType: "image/jpeg" };
        }),
      );
      const prompt = buildVideoAnalysisPrompt({
        durationSeconds,
        speechTranscript: transcript,
        productName: job.values.productName,
        productImageCount: productImages.length,
        demand: job.values.description,
      });
      const analysis: Awaited<ReturnType<typeof analyzeVideoWithGemini>> = await analyzeVideoWithGemini({
        videoPath,
        prompt,
        model: env.videoAnalysisModel,
        productImages,
      });
      analysisStage.completedAt = new Date().toISOString();
      provenance.push(analysisStage);
      const values = { ...job.values, transcript, analysisPrompt: analysis.text };
      const result: JobResult = {
        kind: "video-remix-analysis",
        title: job.title,
        summary: "视频人物、商品、场景、口播和分镜提示词已完成反解析。",
        artifacts: [
          {
            id: crypto.randomUUID(),
            name: "video-analysis-prompt.md",
            mimeType: "text/markdown",
            text: analysis.text,
            executionMode: "real",
            lineage: provenance,
          },
        ],
        data: { values, generatedAt: new Date().toISOString(), mock: false },
      };
      context.change(job.id, {
        status: "succeeded",
        stage: "提示词已生成",
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
