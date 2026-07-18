import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, relative, resolve } from "node:path";
import { APP_CONFIG } from "../../src/app/config";
import type { ModuleId } from "../../src/entities/types";
import { buildVideoAnalysisPrompt } from "../../src/features/video-remix/video-analysis-prompt";
import type { AccountStore } from "../accounts/account-store";
import { env } from "../env";
import {
  extractAudio,
  extractCompressedAudio,
  extractFrame,
  generateSampleVideo,
  normalizeReferenceImage,
  probeMedia,
} from "../media/ffmpeg";
import { isSeedanceModelId, type SeedanceModelId, type SeedanceReferenceKind } from "../models/video-models";
import { aihubmix } from "../providers/aihubmix";
import { analyzeVideoWithGemini, transcribeMediaWithAihubmix } from "../providers/gemini-video-analysis";
import { ossutils } from "../storage/ossutils";
import type { JobRecord, JobResult, StageProvenance } from "../types";
import type { SqliteJobStore } from "./sqlite-job-store";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const mockMedia = new Map<string, Promise<string>>();

type ArtifactDraft = {
  id: string;
  name: string;
  mimeType: string;
  url?: string;
  text?: string;
  executionMode: JobRecord["overallExecutionMode"];
};

class SeedanceFlowError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = true,
  ) {
    super(message);
  }
}

function assetIdsFromValues(values: Record<string, string>) {
  const ids = new Set<string>();
  for (const value of Object.values(values)) {
    if (value.startsWith("asset:")) {
      const id = value.split(":", 3)[1];
      if (id) ids.add(id);
    }
    if (value.startsWith("assets:"))
      try {
        for (const item of JSON.parse(value.slice(7)) as Array<{ id?: unknown }>) {
          if (typeof item.id === "string" && !item.id.startsWith("library-")) ids.add(item.id);
        }
      } catch {
        /* request validation reports malformed values separately */
      }
  }
  return [...ids];
}

function referenceKind(mimeType: string): SeedanceReferenceKind | undefined {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return undefined;
}

async function sha256File(path: string) {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

function outputKind(job: JobRecord): "video" | "audio" | "image" | "text" {
  if (job.moduleId === "voice-clone") return "audio";
  if (job.moduleId === "ai-generate")
    return job.values.type === "图片" ? "image" : job.values.type === "视频" ? "video" : "text";
  if (job.moduleId === "ad-script" || job.moduleId === "media-understand") return "text";
  return "video";
}

async function ensureMockMedia(kind: "video" | "audio" | "image"): Promise<ArtifactDraft> {
  const extension = kind === "video" ? "mp4" : kind === "audio" ? "wav" : "png";
  const mimeType = kind === "video" ? "video/mp4" : kind === "audio" ? "audio/wav" : "image/png";
  const name = `mock-preview.${extension}`;
  const path = resolve(env.dataDir, "results", name);
  let pending = mockMedia.get(kind);
  if (!pending) {
    pending = (async () => {
      if (existsSync(path)) return path;
      const sample = resolve(env.dataDir, "results", "mock-preview.mp4");
      if (kind === "video") await generateSampleVideo(sample);
      else await ensureMockMedia("video");
      if (kind === "audio") await extractAudio(sample, path);
      if (kind === "image") await extractFrame(sample, path);
      return path;
    })();
    mockMedia.set(kind, pending);
  }
  await pending;
  return { id: crypto.randomUUID(), name, mimeType, url: `/api/artifacts/${name}`, executionMode: "mock" };
}

function overallMode(provenance: StageProvenance[], artifacts: ArtifactDraft[]): JobRecord["overallExecutionMode"] {
  const modes = new Set([
    ...provenance.map((stage) => stage.executionMode),
    ...artifacts.map((artifact) => artifact.executionMode),
  ]);
  return modes.size === 1 ? [...modes][0] : "mixed";
}

export const stageMap: Record<ModuleId, Array<[string, string]>> = {
  "video-remix": [
    ["media-probe", "素材校验"],
    ["video-understand", "AI 解析"],
    ["text-rewrite", "提示词改写"],
    ["storyboard", "分镜生成"],
    ["video-generate", "画面生成"],
    ["media-compose", "合并成片"],
  ],
  "video-create": [
    ["text-generate", "脚本生成"],
    ["asset-match", "素材匹配"],
    ["speech-synthesize", "智能配音"],
    ["subtitle-align", "字幕对齐"],
    ["media-compose", "智能成片"],
  ],
  "ad-script": [
    ["text-generate", "脚本生成"],
    ["structured-output", "结构校验"],
  ],
  "ai-generate": [
    ["prompt-understand", "理解指令"],
    ["multimodal-generate", "生成内容"],
  ],
  "video-cut": [
    ["media-probe", "媒体探测"],
    ["video-split", "智能切分"],
  ],
  "media-understand": [
    ["media-probe", "媒体探测"],
    ["media-understand", "内容理解"],
    ["timeline-label", "时间轴标签"],
  ],
  "video-mashup": [
    ["media-probe", "素材校验"],
    ["asset-arrange", "素材编排"],
    ["batch-render", "批量渲染"],
  ],
  "voice-clone": [
    ["audio-validate", "样本验证"],
    ["voice-clone", "音色训练"],
    ["speech-synthesize", "试听生成"],
  ],
  "video-renewal": [
    ["issue-detect", "问题检测"],
    ["video-restore", "视频修复"],
  ],
  "subtitle-erase": [
    ["region-track", "区域跟踪"],
    ["region-inpaint", "擦除补全"],
  ],
  "video-enhancement": [
    ["media-probe", "画质评估"],
    ["video-enhance", "画质增强"],
  ],
  kickart: [
    ["variant-plan", "裂变规划"],
    ["text-variants", "文案变体"],
    ["batch-render", "批量渲染"],
  ],
};

const textCapabilities = new Set([
  "text-generate",
  "structured-output",
  "text-rewrite",
  "storyboard",
  "prompt-understand",
  "text-variants",
  "variant-plan",
  "asset-arrange",
]);
const verifiedSdkIds = new Set<string>();
for (const file of ["capabilities.json", "ffmpeg-capabilities.json"])
  try {
    const capabilityFile = JSON.parse(readFileSync(resolve(env.dataDir, file), "utf8")) as {
      entries?: Array<{ id: string; status: string }>;
    };
    for (const entry of capabilityFile.entries ?? [])
      if (entry.status === "verified" || entry.status === "local") verifiedSdkIds.add(entry.id);
  } catch {
    /* no verified capabilities in this environment */
  }

export function buildExecutionPlan(
  moduleId: ModuleId,
  values: Record<string, string>,
  videoModel?: SeedanceModelId,
): StageProvenance[] {
  return stageMap[moduleId].map(([capability], index) => {
    let executionMode: StageProvenance["executionMode"] = "mock",
      implementation = "yaozuo-mock-provider",
      model: string | undefined;
    const localSdkId = capability.includes("probe")
      ? "ffmpeg-probe"
      : capability.includes("compose")
        ? "ffmpeg-compose"
        : capability.includes("split")
          ? "ffmpeg-split"
          : capability === "video-denoise"
            ? "ffmpeg-denoise"
            : undefined;
    if (localSdkId && verifiedSdkIds.has(localSdkId)) {
      executionMode = "local";
      implementation = "ffmpeg-local";
    } else if (
      !env.forceMock &&
      aihubmix.configured &&
      verifiedSdkIds.has("aihubmix-text") &&
      textCapabilities.has(capability)
    ) {
      executionMode = "real";
      implementation = "aihubmix-text";
      model = "gpt-4.1-nano-free";
    } else if (
      !env.forceMock &&
      aihubmix.configured &&
      verifiedSdkIds.has("aihubmix-audio") &&
      capability === "speech-synthesize"
    ) {
      executionMode = "real";
      implementation = "aihubmix-audio";
      model = "tts-1";
    } else if (!env.forceMock && aihubmix.configured && videoModel && capability === "video-generate") {
      executionMode = "real";
      implementation = "aihubmix-video";
      model = videoModel;
    } else if (!env.forceMock && aihubmix.configured && capability === "multimodal-generate") {
      const type = values.type ?? "营销文案";
      executionMode = "real";
      if (type === "图片" && values.modelId === "gpt-image-1-mini" && verifiedSdkIds.has("aihubmix-image")) {
        implementation = "aihubmix-image";
        model = "gpt-image-1-mini";
      } else if (type === "视频" && videoModel) {
        implementation = "aihubmix-video";
        model = videoModel;
      } else if (type !== "图片" && type !== "视频" && verifiedSdkIds.has("aihubmix-text")) {
        implementation = "aihubmix-text";
        model = "gpt-4.1-nano-free";
      } else {
        executionMode = "mock";
        implementation = "yaozuo-mock-provider";
        model = undefined;
      }
    }
    return {
      id: `plan:${index}:${capability}`,
      capability,
      executionMode,
      implementation,
      provider: executionMode === "real" ? "aihubmix" : undefined,
      model,
      fallbackReason: executionMode === "mock" ? "真实接口尚未映射或测试环境强制 Mock" : undefined,
      startedAt: "",
    };
  });
}

const textSummary: Record<ModuleId, string> = {
  "video-remix": "二创视频已完成，保留原片结构并生成了新的口播与镜头。",
  "video-create": "完整成片已生成，包含配音、字幕和转场。",
  "ad-script": "已生成三版不同开场的高转化口播脚本。",
  "ai-generate": "创作内容已按指令生成，可继续追问或创建变体。",
  "video-cut": "视频已按所选策略切分为可复用片段。",
  "media-understand": "素材人物、场景、对白、商品与情绪标签已生成。",
  "video-mashup": "混剪批次已完成，可预览并下载差异化版本。",
  "voice-clone": "模拟音色已创建，可输入文本生成试听。",
  "video-renewal": "视频问题已检测并生成修复版本。",
  "subtitle-erase": "字幕区域已跟踪并完成背景补全。",
  "video-enhancement": "视频清晰度、色彩与细节已增强。",
  kickart: "裂变矩阵已生成，可对比和筛选版本。",
};

type Listener = (job: JobRecord) => void;

export class MemoryJobQueue {
  private readonly pending: string[] = [];
  private readonly queued = new Set<string>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private active = 0;

  constructor(
    readonly store: SqliteJobStore,
    private readonly accounts?: AccountStore,
    private readonly concurrency = 2,
  ) {}

  state() {
    return { pending: this.pending.length, queued: this.queued.size, active: this.active };
  }

  start() {
    void this.recoverObjectCleanup();
    for (const job of this.store.recoverable()) {
      if (job.ownerUserId === "legacy") continue;
      if (job.providerStatus === "submitting" && !job.providerTaskId) {
        this.store.update(job.id, {
          status: "failed",
          stage: "上游提交状态未知",
          error: {
            code: "PROVIDER_SUBMISSION_UNKNOWN",
            message: "上游提交结果未知，需要人工核对以避免重复计费",
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        });
        continue;
      }
      this.store.update(job.id, { status: "queued", stage: "等待恢复", progress: Math.min(job.progress, 95) });
      this.enqueue(job.id);
    }
  }

  private async recoverObjectCleanup() {
    for (const item of this.store.pendingObjectCleanup()) {
      try {
        await ossutils.markCleanupReady(item.object_key);
        await ossutils.deleteObject(item.object_key);
        this.store.completeObjectCleanup(item.object_key);
        const job = this.store.get(item.job_id);
        if (job) this.store.update(job.id, { stagingKeys: job.stagingKeys.filter((key) => key !== item.object_key) });
      } catch (error) {
        this.store.deferObjectCleanup(item.object_key, error, item.attempts);
      }
    }
  }

  recoverOwned(ownerUserId: string) {
    for (const job of this.store.recoverable().filter((item) => item.ownerUserId === ownerUserId)) {
      if (job.providerStatus === "submitting" && !job.providerTaskId) {
        this.store.update(job.id, {
          status: "failed",
          stage: "上游提交状态未知",
          error: {
            code: "PROVIDER_SUBMISSION_UNKNOWN",
            message: "上游提交结果未知，需要人工核对以避免重复计费",
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        });
        continue;
      }
      this.store.update(job.id, { status: "queued", stage: "等待恢复", progress: Math.min(job.progress, 95) });
      this.enqueue(job.id);
    }
  }

  enqueue(id: string) {
    if (this.queued.has(id)) return;
    this.queued.add(id);
    this.pending.push(id);
    void this.drain();
  }

  subscribe(id: string, listener: Listener) {
    const set = this.listeners.get(id) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(id, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(id);
    };
  }

  private emit(job: JobRecord) {
    for (const listener of this.listeners.get(job.id) ?? []) listener(job);
  }

  private change(id: string, patch: Partial<JobRecord>) {
    const job = this.store.update(id, patch);
    if (job) this.emit(job);
    return job;
  }

  private async drain() {
    while (this.active < this.concurrency && this.pending.length) {
      const id = this.pending.shift()!;
      this.queued.delete(id);
      this.active += 1;
      void this.run(id).finally(() => {
        this.active -= 1;
        void this.drain();
      });
    }
  }

  private async prepareSeedanceReferences(job: JobRecord) {
    if (!this.accounts) throw new SeedanceFlowError("ACCOUNT_STORE_UNAVAILABLE", "素材所有权服务不可用", false);
    if (!ossutils.configured) throw new SeedanceFlowError("TOS_NOT_CONFIGURED", "TOS 素材中转未配置", false);
    const ids = assetIdsFromValues(job.values);
    const uploadRoot = resolve(env.dataDir, "uploads");
    const counts = new Map<SeedanceReferenceKind, number>();
    let totalBytes = 0;
    const prepared: Array<{
      kind: SeedanceReferenceKind;
      path: string;
      mimeType: string;
      sizeBytes: number;
      extension: string;
    }> = [];
    for (const id of ids) {
      const asset = this.accounts.getOwnedAsset(job.ownerUserId, id);
      if (!asset) throw new SeedanceFlowError("ASSET_NOT_AVAILABLE", "引用素材不存在或不属于当前账号", false);
      const kind = referenceKind(asset.mimeType);
      if (!kind)
        throw new SeedanceFlowError("UNSUPPORTED_REFERENCE_TYPE", `Seedance 不支持素材类型 ${asset.mimeType}`, false);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      if ((counts.get(kind) ?? 0) > 1)
        throw new SeedanceFlowError("TOO_MANY_REFERENCES", `每类最多上传一个${kind}参考`, false);
      const limit = kind === "image" ? 10 * 1024 * 1024 : kind === "video" ? 200 * 1024 * 1024 : 50 * 1024 * 1024;
      if (asset.byteSize > limit) throw new SeedanceFlowError("REFERENCE_TOO_LARGE", `${kind}参考超过大小限制`, false);
      totalBytes += asset.byteSize;
      const path = resolve(uploadRoot, asset.storageKey);
      const local = relative(uploadRoot, path);
      if (!local || local.startsWith("..") || local.startsWith("/") || !existsSync(path))
        throw new SeedanceFlowError("INVALID_ASSET_PATH", "素材文件路径无效", false);
      const file = Bun.file(path);
      if (file.size !== asset.byteSize)
        throw new SeedanceFlowError("ASSET_SIZE_MISMATCH", "素材文件大小与记录不一致", false);
      const probe = await probeMedia(path);
      if (kind === "video" && !probe.streams.some((stream) => stream.codec_type === "video"))
        throw new SeedanceFlowError("INVALID_VIDEO_REFERENCE", "视频参考无法解码", false);
      if (kind === "audio" && !probe.streams.some((stream) => stream.codec_type === "audio"))
        throw new SeedanceFlowError("INVALID_AUDIO_REFERENCE", "音频参考无法解码", false);
      if (kind === "image" && !probe.streams.some((stream) => stream.codec_type === "video"))
        throw new SeedanceFlowError("INVALID_IMAGE_REFERENCE", "图片参考无法解码", false);
      prepared.push({
        kind,
        path,
        mimeType: asset.mimeType,
        sizeBytes: asset.byteSize,
        extension: extname(asset.storageKey),
      });
    }
    if (prepared.length > 3 || totalBytes > 250 * 1024 * 1024)
      throw new SeedanceFlowError("REFERENCES_TOO_LARGE", "参考素材总量超过限制", false);

    const references: Array<{ kind: SeedanceReferenceKind; url: string }> = [];
    for (const item of prepared) {
      if (this.store.get(job.id)?.cancelRequested) throw new SeedanceFlowError("JOB_CANCELLED", "任务已取消", false);
      const uploaded = await ossutils.putStagedFile({
        filePath: item.path,
        sizeBytes: item.sizeBytes,
        sha256: await sha256File(item.path),
        mimeType: item.mimeType,
        jobId: job.id,
        extension: item.extension,
      });
      const latest = this.store.get(job.id)!;
      this.change(job.id, { stagingKeys: [...latest.stagingKeys, uploaded.key] });
      references.push({ kind: item.kind, url: ossutils.createSignedReadUrl(uploaded.key) });
    }
    return references;
  }

  private async cleanupStaging(jobId: string) {
    const current = this.store.get(jobId);
    if (!current?.stagingKeys.length) return;
    const failed: string[] = [];
    for (const key of current.stagingKeys) {
      try {
        await ossutils.markCleanupReady(key);
        await ossutils.deleteObject(key);
      } catch (error) {
        failed.push(key);
        this.store.scheduleObjectCleanup(jobId, key, error);
      }
    }
    this.change(jobId, { stagingKeys: failed });
  }

  private async runSeedance(job: JobRecord, model: SeedanceModelId) {
    let taskId = job.providerTaskId;
    let terminalConfirmed = false;
    let reconciliationReason: "cancel" | "timeout" | undefined;
    if (!taskId) {
      if (job.providerStatus === "submitting")
        throw new SeedanceFlowError("PROVIDER_SUBMISSION_UNKNOWN", "上游提交结果未知，需要人工核对后再重试", false);
      this.change(job.id, { providerModel: model, providerStatus: "staging", providerCancelState: "none" });
      let references: Awaited<ReturnType<MemoryJobQueue["prepareSeedanceReferences"]>>;
      try {
        references = await this.prepareSeedanceReferences(job);
      } catch (error) {
        await this.cleanupStaging(job.id);
        throw error;
      }
      this.change(job.id, { providerStatus: "submitting" });
      try {
        const created = await aihubmix.createSeedanceVideo({
          model,
          prompt:
            job.values.prompt ||
            job.values.topic ||
            job.values.description ||
            "A polished product video in a clean bright studio, stable camera",
          resolution: "720p",
          ratio: job.values.ratio?.startsWith("9:16") ? "9:16" : job.values.ratio?.startsWith("1:1") ? "1:1" : "16:9",
          duration: 5,
          // All three approved Seedance 2.0 variants were verified to ignore
          // generate_audio=false, so production requests use the supported path.
          generateAudio: true,
          watermark: false,
          references,
        });
        taskId = created.id;
        const submittedAt = new Date();
        this.change(job.id, {
          providerTaskId: taskId,
          providerStatus: created.status || "submitted",
          providerSubmittedAt: submittedAt.toISOString(),
          providerDeadlineAt: new Date(submittedAt.getTime() + 20 * 60_000).toISOString(),
        });
      } catch (error) {
        const definitelyRejected = error instanceof Error && /AIHUBMIX_4(00|01|03|04|13|22):/.test(error.message);
        if (!definitelyRejected) {
          this.change(job.id, { providerStatus: "submission_unknown" });
          throw new SeedanceFlowError(
            "PROVIDER_SUBMISSION_UNKNOWN",
            "上游提交结果未知，需要人工核对以避免重复计费",
            false,
          );
        }
        terminalConfirmed = true;
        await this.cleanupStaging(job.id);
        throw error;
      }
    }

    const deadline = Date.parse(
      this.store.get(job.id)?.providerDeadlineAt ?? new Date(Date.now() + 20 * 60_000).toISOString(),
    );
    let cancelAttempted = false;
    try {
      while (true) {
        const latest = this.store.get(job.id)!;
        if (!reconciliationReason && latest.cancelRequested) reconciliationReason = "cancel";
        if (!reconciliationReason && Date.now() >= deadline) reconciliationReason = "timeout";
        if (reconciliationReason && !cancelAttempted) {
          cancelAttempted = true;
          try {
            const state = await aihubmix.cancelVideo(taskId);
            this.change(job.id, {
              providerCancelState: state,
              providerStatus: "reconciling",
              stage: reconciliationReason === "cancel" ? "取消核对中" : "超时核对中",
            });
          } catch {
            this.change(job.id, {
              providerCancelState: "failed",
              providerStatus: "reconciling",
              stage: reconciliationReason === "cancel" ? "取消核对中" : "超时核对中",
            });
          }
        }
        let task;
        try {
          task = await aihubmix.getVideo(taskId);
        } catch {
          this.change(job.id, {
            providerStatus: "reconciling",
            stage:
              reconciliationReason === "cancel"
                ? "取消核对中"
                : reconciliationReason === "timeout"
                  ? "超时核对中"
                  : "上游状态核对中",
          });
          await wait(reconciliationReason ? 60_000 : 15_000);
          continue;
        }
        this.change(job.id, { providerStatus: reconciliationReason ? "reconciling" : task.status });
        if (["completed", "succeeded"].includes(task.status)) {
          terminalConfirmed = true;
          if (reconciliationReason === "cancel") throw new SeedanceFlowError("JOB_CANCELLED", "任务已取消", false);
          if (reconciliationReason === "timeout")
            throw new SeedanceFlowError("UPSTREAM_COMPLETED_AFTER_TIMEOUT", "上游在本地超时后完成，结果已丢弃", true);
          return await aihubmix.downloadVideo(taskId);
        }
        if (["failed", "cancelled", "expired"].includes(task.status)) {
          terminalConfirmed = true;
          if (reconciliationReason === "cancel") throw new SeedanceFlowError("JOB_CANCELLED", "任务已取消", false);
          throw new SeedanceFlowError(`AIHUBMIX_VIDEO_${task.status.toUpperCase()}`, "视频生成上游任务失败", true);
        }
        await wait(reconciliationReason ? 60_000 : 5_000);
      }
    } finally {
      if (terminalConfirmed) await this.cleanupStaging(job.id);
    }
  }

  private async runVideoRemixAnalysis(job: JobRecord) {
    const startedAt = new Date().toISOString();
    const provenance: StageProvenance[] = [];
    try {
      if (!this.accounts) throw new Error("素材所有权服务不可用");
      const sourceAssetId = job.values.source?.split(":", 3)[1];
      if (!sourceAssetId) throw new Error("视频素材标识无效");
      const asset = this.accounts.getOwnedAsset(job.ownerUserId, sourceAssetId);
      if (!asset || !asset.mimeType.startsWith("video/")) throw new Error("视频素材不存在或不属于当前账号");
      const uploadRoot = resolve(env.dataDir, "uploads");
      const videoPath = resolve(uploadRoot, asset.storageKey);
      const local = relative(uploadRoot, videoPath);
      if (!local || local.startsWith("..") || local.startsWith("/") || !existsSync(videoPath))
        throw new Error("视频素材文件不存在");

      const probeStage: StageProvenance = {
        id: `${job.id}:probe`,
        capability: "media-probe",
        executionMode: "local",
        implementation: "ffprobe-local",
        startedAt,
      };
      this.change(job.id, { status: "processing", stage: "分析视频结构", progress: 10, provenance: [probeStage] });
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
      this.change(job.id, { stage: "识别原声口播", progress: 30, provenance: [...provenance, transcriptionStage] });
      let transcript = "";
      const tempDir = await mkdtemp(resolve(tmpdir(), "yaozuo-remix-analysis-"));
      try {
        const audioPath = resolve(tempDir, "source.mp3");
        await extractCompressedAudio(videoPath, audioPath);
        const transcription = await transcribeMediaWithAihubmix({ mediaPath: audioPath, mimeType: "audio/mpeg" });
        transcript = transcription.text;
      } catch (error) {
        transcriptionStage.fallbackReason = `独立转写不可用，改由视频模型直接理解原声：${error instanceof Error ? error.message.slice(0, 160) : "未知错误"}`;
      } finally {
        await rm(tempDir, { recursive: true, force: true });
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
      this.change(job.id, {
        stage: "生成分镜提示词",
        progress: 60,
        values: { ...job.values, transcript },
        provenance: [...provenance, analysisStage],
      });
      let productImageIds: string[] = [];
      try {
        const parsedIds = JSON.parse(job.values.productImageAssetIds || "[]");
        if (Array.isArray(parsedIds)) productImageIds = parsedIds.filter((id): id is string => typeof id === "string");
      } catch {
        throw new Error("商品参考图配置无效");
      }
      const referenceAssets = productImageIds.map((id) => this.accounts?.getOwnedAsset(job.ownerUserId, id));
      if (
        !referenceAssets.length ||
        referenceAssets.some((reference) => !reference || !reference.mimeType.startsWith("image/"))
      )
        throw new Error("商品参考图不存在或不属于当前账号");

      const referenceTempDir = await mkdtemp(resolve(tmpdir(), "yaozuo-product-reference-"));
      let analysis: Awaited<ReturnType<typeof analyzeVideoWithGemini>>;
      try {
        const productImages = await Promise.all(
          referenceAssets.map(async (reference, index) => {
            if (!reference) throw new Error("商品参考图不存在");
            const inputPath = resolve(uploadRoot, reference.storageKey);
            const localReference = relative(uploadRoot, inputPath);
            if (
              !localReference ||
              localReference.startsWith("..") ||
              localReference.startsWith("/") ||
              !existsSync(inputPath)
            )
              throw new Error("商品参考图文件不存在");
            const outputPath = resolve(referenceTempDir, `product-${index + 1}.jpg`);
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
        analysis = await analyzeVideoWithGemini({
          videoPath,
          prompt,
          model: env.videoAnalysisModel,
          productImages,
        });
      } finally {
        await rm(referenceTempDir, { recursive: true, force: true });
      }
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
      this.change(job.id, {
        status: "succeeded",
        stage: "提示词已生成",
        progress: 100,
        values,
        provenance,
        result,
        overallExecutionMode: "real",
      });
    } catch (error) {
      this.change(job.id, {
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
    }
  }

  private async run(id: string) {
    let job = this.store.get(id);
    if (!job || job.status === "cancelled") return;
    if (job.moduleId === "video-remix" && job.values.workflowPhase === "analysis") {
      await this.runVideoRemixAnalysis(job);
      return;
    }
    if (job.values.__scenario === "insufficient-credits") {
      await wait(250);
      this.change(id, {
        status: "failed",
        stage: "计费校验",
        progress: 0,
        error: {
          code: "INSUFFICIENT_CREDITS",
          message: "创作点不足，请调整任务或充值",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      });
      return;
    }
    const stages = stageMap[job.moduleId];
    const plan = job.executionPlan.length
      ? job.executionPlan
      : buildExecutionPlan(job.moduleId, job.values, job.videoModel);
    if (!job.executionPlan.length) this.change(id, { executionPlan: plan });
    job = this.change(id, { status: "processing", stage: stages[0][1], progress: Math.max(5, job.progress) });
    if (!job) return;
    const provenance: StageProvenance[] = job.providerTaskId
      ? job.provenance.filter((stage) => Boolean(stage.completedAt))
      : [];
    const produced: ArtifactDraft[] = [];
    const resumedVideoIndex = job.providerTaskId
      ? plan.findIndex((stage) => stage.implementation === "aihubmix-video")
      : -1;
    for (let index = resumedVideoIndex >= 0 ? resumedVideoIndex : 0; index < stages.length; index += 1) {
      const latest = this.store.get(id);
      if (!latest || latest.cancelRequested) {
        this.change(id, { status: "cancelled", stage: "已取消", progress: latest?.progress ?? 0 });
        return;
      }
      const [capability, label] = stages[index];
      if (job.values.__scenario === "fail-analysis" && index === Math.min(1, stages.length - 1)) {
        await wait(300);
        this.change(id, {
          status: "failed",
          stage: `${label}失败`,
          progress: 42,
          provenance,
          error: {
            code: "PROCESSING_FAILED",
            message: "素材分析中断，请检查文件后重试",
            retryable: true,
            requestId: crypto.randomUUID(),
          },
        });
        return;
      }
      const stage: StageProvenance = {
        ...plan[index],
        id: `${id}:${index}`,
        startedAt: new Date().toISOString(),
      };
      this.change(id, {
        stage: label,
        progress: Math.round(8 + (index / stages.length) * 82),
        provenance: [...provenance, stage],
        overallExecutionMode: "mixed",
      });
      try {
        if (stage.executionMode === "real" && stage.implementation === "aihubmix-text") {
          const response = await aihubmix.generateText(
            `你是${APP_CONFIG.projectName}创作助手。为 ${job.moduleId} 执行 ${capability}。用户配置：${JSON.stringify(job.values)}。输出简洁中文结果。`,
            stage.model,
          );
          produced.push({
            id: crypto.randomUUID(),
            name: `${capability}.txt`,
            mimeType: "text/plain",
            text: response.text,
            executionMode: "real",
          });
        } else if (stage.executionMode === "real" && stage.implementation === "aihubmix-image") {
          const response = await aihubmix.generateImage(
            job.values.prompt || "A polished product advertising image, clean studio lighting",
            stage.model,
          );
          const bytes = response.b64_json
            ? Uint8Array.from(atob(response.b64_json), (character) => character.charCodeAt(0))
            : await fetch(response.url!).then((item) => item.bytes());
          const name = `${id}-${capability}.png`;
          await Bun.write(resolve(env.dataDir, "results", name), bytes);
          produced.push({
            id: crypto.randomUUID(),
            name,
            mimeType: "image/png",
            url: `/api/artifacts/${name}`,
            executionMode: "real",
          });
        } else if (stage.executionMode === "real" && stage.implementation === "aihubmix-audio") {
          const response = await aihubmix.synthesizeSpeech(
            job.values.topic || job.values.prompt || `${APP_CONFIG.projectName}智能创作结果已生成。`,
            stage.model,
          );
          const name = `${id}-${capability}.wav`;
          await Bun.write(resolve(env.dataDir, "results", name), response.bytes);
          produced.push({
            id: crypto.randomUUID(),
            name,
            mimeType: "audio/wav",
            url: `/api/artifacts/${name}`,
            executionMode: "real",
          });
        } else if (stage.executionMode === "real" && stage.implementation === "aihubmix-video") {
          if (!isSeedanceModelId(stage.model))
            throw new SeedanceFlowError("INVALID_VIDEO_MODEL", "视频模型无效", false);
          const response = await this.runSeedance(job, stage.model);
          const name = `${id}-${capability}.mp4`;
          await Bun.write(resolve(env.dataDir, "results", name), response.bytes);
          await probeMedia(resolve(env.dataDir, "results", name));
          produced.push({
            id: crypto.randomUUID(),
            name,
            mimeType: "video/mp4",
            url: `/api/artifacts/${name}`,
            executionMode: "real",
          });
        } else await wait(stage.executionMode === "mock" ? 350 : 120);
      } catch (error) {
        if (error instanceof SeedanceFlowError && error.code === "JOB_CANCELLED") {
          this.change(id, { status: "cancelled", stage: "已取消", error: undefined });
          return;
        }
        if (stage.implementation === "aihubmix-video" || !env.allowMockFallback) {
          this.change(id, {
            status: "failed",
            stage: `${label}失败`,
            error: {
              code: error instanceof SeedanceFlowError ? error.code : "PROVIDER_ERROR",
              message: error instanceof Error ? error.message : "上游接口失败",
              retryable: error instanceof SeedanceFlowError ? error.retryable : true,
              requestId: crypto.randomUUID(),
            },
          });
          return;
        }
        stage.executionMode = "mock";
        stage.implementation = "yaozuo-mock-provider";
        stage.fallbackReason = error instanceof Error ? error.message : "上游接口失败";
        await wait(350);
      }
      stage.completedAt = new Date().toISOString();
      provenance.push(stage);
      this.change(id, { progress: Math.round(8 + ((index + 1) / stages.length) * 82), provenance: [...provenance] });
    }
    const expected = outputKind(job);
    if (expected !== "text" && !produced.some((artifact) => artifact.mimeType.startsWith(`${expected}/`)))
      produced.push(await ensureMockMedia(expected));
    const finalArtifacts: ArtifactDraft[] = produced.length
      ? produced
      : [
          {
            id: crypto.randomUUID(),
            name: `${job.moduleId}-result.json`,
            mimeType: "application/json",
            text: textSummary[job.moduleId],
            executionMode: provenance.some((stage) => stage.executionMode === "real") ? "real" : "mock",
          },
        ];
    const owner = this.accounts?.getUser(job.ownerUserId);
    for (const artifact of finalArtifacts)
      if (artifact.url && this.accounts && owner) {
        this.accounts.createArtifact({
          id: artifact.id,
          ownerUserId: job.ownerUserId,
          jobId: job.id,
          storageKey: artifact.name,
          name: artifact.name,
          mimeType: artifact.mimeType,
          createdAt: new Date().toISOString(),
        });
        artifact.url = `/api/artifacts/${artifact.id}`;
      }
    const artifactMode = overallMode(provenance, finalArtifacts);
    const result: JobResult = {
      kind: job.moduleId,
      title: job.title,
      summary: textSummary[job.moduleId],
      artifacts: finalArtifacts.map((artifact) => ({ ...artifact, lineage: provenance })),
      data: {
        values: job.values,
        generatedAt: new Date().toISOString(),
        mock: artifactMode === "mock" || artifactMode === "mixed",
      },
    };
    this.change(id, {
      status: job.values.__scenario === "partial-batch" ? "partially_succeeded" : "succeeded",
      stage: job.values.__scenario === "partial-batch" ? "部分完成" : "已完成",
      progress: 100,
      provenance,
      result,
      overallExecutionMode: artifactMode,
    });
    if (owner && this.accounts?.taskNotificationsEnabled(job.ownerUserId))
      this.accounts.createNotification(
        job.ownerUserId,
        "task_completed",
        "创作任务已完成",
        `${job.title} 已生成，可前往任务中心查看。`,
        job.id,
      );
  }
}
