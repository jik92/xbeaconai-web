import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve } from "node:path";
import { probeMedia } from "../../server/media/ffmpeg";
import type { SeedanceModelId, SeedanceReferenceKind } from "../../server/models/video-models";
import { resolvePortraitReference } from "../../server/portraits/portrait-resolver";
import { arkSeedance } from "../../server/providers/ark-seedance";
import { ossutils } from "../../server/storage/ossutils";
import type { JobRecord } from "../../server/types";
import { parsePortraitReference } from "../../shared/portraits/portrait-reference";
import type { JobHandlerContext } from "./types";
import { assetIdsFromValues } from "./utils";
import { materializeRemoteAsset } from "./video-remix-assets";

const wait = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
export const SEEDANCE_DURATION_TOLERANCE_SECONDS = 1;
type SeedanceRatio = "16:9" | "9:16" | "1:1";

export class SeedanceFlowError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = true,
  ) {
    super(message);
  }
}

function mediaDurationSec(metadata: Awaited<ReturnType<typeof probeMedia>>) {
  return Number(
    metadata.format.duration ??
      metadata.streams.find((stream) => stream.codec_type === "video")?.duration ??
      metadata.streams.find((stream) => stream.codec_type === "audio")?.duration,
  );
}

export function assertSeedanceDuration(requestedDurationSec: number, actualDurationSec: number, source: string) {
  if (!Number.isFinite(actualDurationSec) || actualDurationSec <= 0)
    throw new SeedanceFlowError("VIDEO_DURATION_INVALID", `${source}未返回有效的视频时长`, true);
  if (Math.abs(actualDurationSec - requestedDurationSec) > SEEDANCE_DURATION_TOLERANCE_SECONDS)
    throw new SeedanceFlowError(
      "VIDEO_DURATION_MISMATCH",
      `请求生成 ${requestedDurationSec} 秒视频，但${source}为 ${actualDurationSec.toFixed(3)} 秒，请重试`,
      true,
    );
  return actualDurationSec;
}

function referenceKind(mimeType: string): SeedanceReferenceKind | undefined {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return undefined;
}

export function seedanceVideoSettings(values: Record<string, string>) {
  const requestedDuration = Number(values.durationSec ?? values.duration ?? 5);
  const duration = Math.min(15, Math.max(4, Math.round(Number.isFinite(requestedDuration) ? requestedDuration : 5))) as
    | 4
    | 5
    | 6
    | 7
    | 8
    | 9
    | 10
    | 11
    | 12
    | 13
    | 14
    | 15;
  const ratio: SeedanceRatio = values.ratio?.startsWith("9:16")
    ? "9:16"
    : values.ratio?.startsWith("1:1")
      ? "1:1"
      : "16:9";
  const resolution: "480p" | "720p" = values.resolution === "480p" ? "480p" : "720p";
  return { duration, ratio, resolution };
}

async function sha256File(path: string) {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest("hex");
}

export class SeedanceVideoJob {
  constructor(private readonly context: JobHandlerContext) {}

  private async prepareReferences(job: JobRecord) {
    const { accounts, store } = this.context;
    if (!accounts) throw new SeedanceFlowError("ACCOUNT_STORE_UNAVAILABLE", "素材所有权服务不可用", false);
    const ids = assetIdsFromValues(job.values);
    if (ids.length && !ossutils.configured)
      throw new SeedanceFlowError("TOS_NOT_CONFIGURED", "TOS 素材中转未配置", false);
    const tempDir = await mkdtemp(resolve(tmpdir(), "yaozuo-seedance-references-"));
    try {
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
        const asset = accounts.getOwnedAsset(job.ownerUserId, id);
        if (!asset) throw new SeedanceFlowError("ASSET_NOT_AVAILABLE", "引用素材不存在或不属于当前账号", false);
        const kind = referenceKind(asset.mimeType);
        if (!kind)
          throw new SeedanceFlowError("UNSUPPORTED_REFERENCE_TYPE", `Seedance 不支持素材类型 ${asset.mimeType}`, false);
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
        const countLimit = kind === "image" ? 9 : 3;
        if ((counts.get(kind) ?? 0) > countLimit)
          throw new SeedanceFlowError("TOO_MANY_REFERENCES", `${kind}参考最多上传 ${countLimit} 个`, false);
        const limit = kind === "image" ? 10 * 1024 * 1024 : kind === "video" ? 200 * 1024 * 1024 : 50 * 1024 * 1024;
        if (asset.byteSize > limit)
          throw new SeedanceFlowError("REFERENCE_TOO_LARGE", `${kind}参考超过大小限制`, false);
        totalBytes += asset.byteSize;
        const path = await materializeRemoteAsset({
          tempDir,
          asset,
          targetName: `${id}${extname(asset.originalName) || ".bin"}`,
          label: `${kind}参考素材`,
          tosConfigured: ossutils.configured,
          download: (storageKey, filePath) => ossutils.downloadLibraryFile(storageKey, filePath),
        });
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
      if (prepared.length > 12 || totalBytes > 250 * 1024 * 1024)
        throw new SeedanceFlowError("REFERENCES_TOO_LARGE", "参考素材总量超过限制", false);

      const references: Array<{ kind: SeedanceReferenceKind; url: string }> = [];
      const portraitReference = parsePortraitReference(job.values.portraitReference, job.values.portraitId);
      if (portraitReference) {
        if (!this.context.customPortraits)
          throw new SeedanceFlowError("PORTRAIT_STORE_UNAVAILABLE", "人像服务不可用", false);
        const portrait = resolvePortraitReference({
          ownerUserId: job.ownerUserId,
          reference: portraitReference,
          accounts,
          customPortraits: this.context.customPortraits,
        });
        if (!portrait) throw new SeedanceFlowError("PORTRAIT_NOT_AVAILABLE", "所选人像不存在或尚未就绪", false);
        if ((counts.get("image") ?? 0) >= 9)
          throw new SeedanceFlowError("TOO_MANY_REFERENCES", "image参考最多上传 9 个", false);
        counts.set("image", (counts.get("image") ?? 0) + 1);
        references.push({ kind: "image", url: portrait.arkAssetUri });
      }
      if (references.length + prepared.length > 12)
        throw new SeedanceFlowError("TOO_MANY_REFERENCES", "参考素材总数最多 12 个", false);
      for (const item of prepared) {
        if (store.get(job.id)?.cancelRequested) throw new SeedanceFlowError("JOB_CANCELLED", "任务已取消", false);
        const uploaded = await ossutils.putStagedFile({
          filePath: item.path,
          sizeBytes: item.sizeBytes,
          sha256: await sha256File(item.path),
          mimeType: item.mimeType,
          jobId: job.id,
          extension: item.extension,
        });
        const latest = store.get(job.id);
        if (!latest || latest.cancelRequested) throw new SeedanceFlowError("JOB_CANCELLED", "任务已取消", false);
        this.context.change(job.id, { stagingKeys: [...latest.stagingKeys, uploaded.key] });
        references.push({ kind: item.kind, url: ossutils.createSignedReadUrl(uploaded.key) });
      }
      return references;
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async cleanupStaging(jobId: string) {
    const current = this.context.store.get(jobId);
    if (!current?.stagingKeys.length) return;
    const failed: string[] = [];
    for (const key of current.stagingKeys) {
      try {
        await ossutils.markCleanupReady(key);
        await ossutils.deleteObject(key);
      } catch (error) {
        failed.push(key);
        this.context.store.scheduleObjectCleanup(jobId, key, error);
      }
    }
    this.context.change(jobId, { stagingKeys: failed });
  }

  async execute(job: JobRecord, model: SeedanceModelId) {
    let taskId = job.providerTaskId;
    if (taskId && job.executionPlan.some((stage) => stage.implementation === "aihubmix-video"))
      throw new SeedanceFlowError(
        "LEGACY_VIDEO_PROVIDER_TASK_UNSUPPORTED",
        "该任务由已移除的 AIHubMix 视频通道提交，无法使用 Ark 继续轮询，请重新生成",
        false,
      );
    let terminalConfirmed = false;
    let reconciliationReason: "cancel" | "timeout" | undefined;
    if (!taskId) {
      if (job.providerStatus === "submitting")
        throw new SeedanceFlowError("PROVIDER_SUBMISSION_UNKNOWN", "上游提交结果未知，需要人工核对后再重试", false);
      this.context.change(job.id, { providerModel: model, providerStatus: "staging", providerCancelState: "none" });
      let references: Awaited<ReturnType<SeedanceVideoJob["prepareReferences"]>>;
      try {
        references = await this.prepareReferences(job);
      } catch (error) {
        await this.cleanupStaging(job.id);
        throw error;
      }
      this.context.change(job.id, { providerStatus: "submitting" });
      try {
        const settings = seedanceVideoSettings(job.values);
        const created = await arkSeedance.createVideo({
          model,
          prompt:
            job.values.prompt ||
            job.values.topic ||
            job.values.description ||
            "A polished product video in a clean bright studio, stable camera",
          resolution: settings.resolution,
          ratio: settings.ratio,
          duration: settings.duration,
          generateAudio: job.values.generateAudio !== "false",
          watermark: false,
          references,
        });
        taskId = created.id;
        const submittedAt = new Date();
        this.context.change(job.id, {
          providerTaskId: taskId,
          providerStatus: created.status || "submitted",
          providerSubmittedAt: submittedAt.toISOString(),
          providerDeadlineAt: new Date(submittedAt.getTime() + 20 * 60_000).toISOString(),
        });
      } catch (error) {
        const definitelyRejected = error instanceof Error && /ARK_4(00|01|03|04|13|22):/.test(error.message);
        if (!definitelyRejected) {
          this.context.change(job.id, { providerStatus: "submission_unknown" });
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
      this.context.store.get(job.id)?.providerDeadlineAt ?? new Date(Date.now() + 20 * 60_000).toISOString(),
    );
    let cancelAttempted = false;
    try {
      while (true) {
        const latest = this.context.store.get(job.id);
        if (!latest) throw new SeedanceFlowError("JOB_NOT_FOUND", "任务记录不存在", false);
        if (!reconciliationReason && latest.cancelRequested) reconciliationReason = "cancel";
        if (!reconciliationReason && Date.now() >= deadline) reconciliationReason = "timeout";
        if (reconciliationReason && !cancelAttempted) {
          cancelAttempted = true;
          try {
            const state = await arkSeedance.cancelVideo(taskId);
            this.context.change(job.id, {
              providerCancelState: state,
              providerStatus: "reconciling",
              stage: reconciliationReason === "cancel" ? "取消核对中" : "超时核对中",
            });
          } catch {
            this.context.change(job.id, {
              providerCancelState: "failed",
              providerStatus: "reconciling",
              stage: reconciliationReason === "cancel" ? "取消核对中" : "超时核对中",
            });
          }
        }
        let task: Awaited<ReturnType<typeof arkSeedance.getVideo>>;
        try {
          task = await arkSeedance.getVideo(taskId);
        } catch {
          this.context.change(job.id, {
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
        this.context.change(job.id, { providerStatus: reconciliationReason ? "reconciling" : task.status });
        if (task.status === "succeeded") {
          terminalConfirmed = true;
          if (reconciliationReason === "cancel") throw new SeedanceFlowError("JOB_CANCELLED", "任务已取消", false);
          if (reconciliationReason === "timeout")
            throw new SeedanceFlowError("UPSTREAM_COMPLETED_AFTER_TIMEOUT", "上游在本地超时后完成，结果已丢弃", true);
          const requestedDurationSec = seedanceVideoSettings(job.values).duration;
          const videoUrl = task.content?.video_url;
          if (!videoUrl) throw new SeedanceFlowError("ARK_VIDEO_URL_MISSING", "Ark 视频任务成功但未返回下载地址", true);
          const downloaded = await arkSeedance.downloadVideo(videoUrl);
          const tempDir = await mkdtemp(resolve(tmpdir(), "yaozuo-seedance-result-"));
          const output = resolve(tempDir, "result.mp4");
          try {
            await Bun.write(output, downloaded.bytes);
            const durationSec = assertSeedanceDuration(
              requestedDurationSec,
              mediaDurationSec(await probeMedia(output)),
              "下载视频实际时长",
            );
            return {
              ...downloaded,
              executionMode: "real" as const,
              implementation: "ark-seedance-video" as const,
              durationSec,
            };
          } finally {
            await rm(tempDir, { recursive: true, force: true });
          }
        }
        if (["failed", "cancelled", "expired"].includes(task.status)) {
          terminalConfirmed = true;
          if (reconciliationReason === "cancel") throw new SeedanceFlowError("JOB_CANCELLED", "任务已取消", false);
          throw new SeedanceFlowError(`ARK_VIDEO_${task.status.toUpperCase()}`, "视频生成上游任务失败", true);
        }
        await wait(reconciliationReason ? 60_000 : 5_000);
      }
    } finally {
      if (terminalConfirmed) await this.cleanupStaging(job.id);
    }
  }
}
