import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { env } from "../../server/env";
import { normalizeReferenceImage, probeMedia } from "../../server/media/ffmpeg";
import { ArkVideoAnalysisError, arkVideoAnalysis } from "../../server/providers/ark-video-analysis";
import { ossutils } from "../../server/storage/ossutils";
import type { JobResult, StageProvenance } from "../../server/types";
import { VideoRemixPromptModelError } from "../../server/video-remix/prompt-rewrite";
import { analyzeScriptRemix, SCRIPT_REMIX_ANALYSIS_MODEL } from "../../server/video-remix/script-analysis";
import { parseRemixSources, type RemixAnalysisEntry, type RemixSourceRef } from "../../shared/video-remix/workflow";
import { buildVideoAnalysisPrompt } from "../../web/features/video-remix/video-analysis-prompt";
import type { WorkerJobHandler } from "./types";
import { materializeRemixReferenceAssets, materializeRemixVideoAsset } from "./video-remix-assets";

function legacySource(value: string | undefined): RemixSourceRef[] {
  const assetId = value?.split(":", 3)[1];
  if (!assetId) return [];
  return [{ assetId, name: value?.split(":").slice(2).join(":") || "source.mp4" }];
}

async function executeScriptRemixAnalysis(
  job: Parameters<WorkerJobHandler["execute"]>[0],
  context: Parameters<WorkerJobHandler["execute"]>[1],
) {
  const { accounts } = context;
  if (!accounts) throw new Error("素材所有权服务不可用");
  const stage: StageProvenance = {
    id: `${job.id}:script-analysis`,
    capability: "text-rewrite",
    executionMode: "real",
    implementation: "ark-multimodal-chat-completions",
    provider: "ark",
    model: SCRIPT_REMIX_ANALYSIS_MODEL,
    startedAt: new Date().toISOString(),
  };
  let tempDir: string | undefined;
  try {
    context.change(job.id, {
      status: "processing",
      stage: "AI 正在拆分脚本分镜",
      progress: 20,
      executionPlan: [stage],
      provenance: [stage],
      overallExecutionMode: "real",
    });
    let productImageIds: string[] = [];
    try {
      const parsed = JSON.parse(job.values.productImageAssetIds || "[]");
      if (Array.isArray(parsed))
        productImageIds = parsed.filter((id): id is string => typeof id === "string").slice(0, 9);
    } catch {
      throw new Error("商品参考图配置无效");
    }
    const referenceAssets = productImageIds.map((id) => accounts.getOwnedAsset(job.ownerUserId, id));
    if (!referenceAssets.length || referenceAssets.some((asset) => !asset?.mimeType.startsWith("image/")))
      throw new Error("商品参考图不存在或不属于当前账号");
    tempDir = await mkdtemp(resolve(tmpdir(), "yaozuo-script-remix-analysis-"));
    const referencePaths = await materializeRemixReferenceAssets({
      tempDir,
      referenceAssets: referenceAssets.filter((asset) => asset !== undefined),
      tosConfigured: ossutils.configured,
      download: (storageKey, filePath) => ossutils.downloadLibraryFile(storageKey, filePath),
    });
    const productImages = await Promise.all(
      referencePaths.map(async (inputPath, index) => {
        const outputPath = resolve(tempDir || "", `product-normalized-${index + 1}.jpg`);
        await normalizeReferenceImage(inputPath, outputPath);
        return { path: outputPath, mimeType: "image/jpeg", label: `Image${index + 1}` };
      }),
    );
    const analysis = await analyzeScriptRemix({
      script: job.values.scriptContent || job.values.description || "",
      productName: job.values.productName || "未命名商品",
      productDescription: job.values.productDescription || "",
      portrait: job.values.portrait || "",
      voice: job.values.voiceName || "",
      productImages,
    });
    stage.completedAt = new Date().toISOString();
    stage.model = analysis.model;
    const entries: RemixAnalysisEntry[] = analysis.shots.map((shot, index) => ({
      assetId: crypto.randomUUID(),
      name: shot.title || `分镜 ${String(index + 1).padStart(2, "0")}`,
      status: "succeeded",
      prompt: shot.prompt,
      transcript: "",
    }));
    const sources = entries.map(({ assetId, name }) => ({ assetId, name }));
    const values = {
      ...job.values,
      sources: JSON.stringify(sources),
      analysisEntries: JSON.stringify(entries),
      analysisPrompt: entries[0]?.prompt ?? "",
      transcript: job.values.scriptContent || "",
    };
    const result: JobResult = {
      kind: "video-remix-analysis",
      title: job.title,
      summary: `已从脚本拆分 ${entries.length} 条分镜。`,
      artifacts: entries.map((entry) => ({
        id: `${job.id}:${entry.assetId}:analysis`,
        name: `${entry.name}.analysis.md`,
        mimeType: "text/markdown",
        text: entry.prompt || "",
        executionMode: "real",
        lineage: [stage],
      })),
      data: { values, generatedAt: new Date().toISOString(), mock: false },
    };
    context.change(job.id, {
      status: "succeeded",
      stage: "脚本分镜提示词已生成",
      progress: 100,
      values,
      provenance: [stage],
      result,
      overallExecutionMode: "real",
    });
  } catch (error) {
    const modelError = error instanceof VideoRemixPromptModelError ? error : undefined;
    context.change(job.id, {
      status: "failed",
      stage: "脚本解析失败",
      provenance: [stage],
      error: {
        code: modelError?.code ?? "SCRIPT_ANALYSIS_FAILED",
        message: modelError?.message ?? (error instanceof Error ? error.message : "脚本解析失败，请稍后重试"),
        retryable: modelError?.retryable ?? true,
        requestId: crypto.randomUUID(),
      },
    });
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
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
      if (job.values.workflowKind === "script") {
        await executeScriptRemixAnalysis(job, context);
        return;
      }
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
      const referencePaths = await materializeRemixReferenceAssets({
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
        let analysisStage: StageProvenance | undefined;
        try {
          const videoPath = await materializeRemixVideoAsset({
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

          analysisStage = {
            id: `${job.id}:${source.assetId}:video-analysis`,
            capability: "video-understand",
            executionMode: "real",
            implementation: "ark-video-analysis",
            provider: "ark",
            model: env.arkVideoAnalysisModel,
            startedAt: new Date().toISOString(),
          };
          context.change(job.id, {
            stage: `Ark 分析视频并生成分镜提示词 ${index + 1}/${sourceRefs.length}`,
            progress: progress(0.4),
            provenance: [...provenance, ...sourceLineage, analysisStage],
          });
          const prompt = buildVideoAnalysisPrompt({
            durationSeconds,
            speechTranscript: "",
            productName: job.values.productName,
            productImageCount: productImages.length,
            demand: job.values.description,
          });
          const analysis = await arkVideoAnalysis.analyzeVideo({
            videoPath,
            prompt,
            model: env.arkVideoAnalysisModel,
            productImages,
          });
          analysisStage.completedAt = new Date().toISOString();
          sourceLineage.push(analysisStage);
          provenance.push(...sourceLineage);
          entries.push({ ...source, status: "succeeded", prompt: analysis.text, transcript: "" });
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
          if (analysisStage && !sourceLineage.includes(analysisStage)) {
            analysisStage.completedAt = new Date().toISOString();
            if (error instanceof ArkVideoAnalysisError) analysisStage.failure = error.failure;
            sourceLineage.push(analysisStage);
          }
          const errorMessage = error instanceof Error ? error.message : "视频解析失败";
          console.warn("[video-remix-analysis] source analysis failed", {
            jobId: job.id,
            assetId: source.assetId,
            failure: analysisStage?.failure,
            message: errorMessage,
          });
          entries.push({
            ...source,
            status: "failed",
            error: errorMessage,
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
      const current = context.store.get(job.id);
      if (current?.cancelRequested || current?.status === "cancelled") {
        context.change(job.id, { status: "cancelled", stage: "已取消", progress: current.progress });
        return;
      }
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
