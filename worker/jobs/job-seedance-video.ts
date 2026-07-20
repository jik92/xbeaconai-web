import { existsSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { env } from "../../server/env";
import { probeMedia } from "../../server/media/ffmpeg";
import type { SeedanceModelId, SeedanceReferenceKind } from "../../server/models/video-models";
import { aihubmix } from "../../server/providers/aihubmix";
import { ossutils } from "../../server/storage/ossutils";
import type { JobRecord } from "../../server/types";
import type { JobHandlerContext } from "./types";
import { assetIdsFromValues } from "./utils";

const wait = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

export class SeedanceFlowError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = true,
  ) {
    super(message);
  }
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

export class SeedanceVideoJob {
  constructor(private readonly context: JobHandlerContext) {}

  private async prepareReferences(job: JobRecord) {
    const { accounts, store } = this.context;
    if (!accounts) throw new SeedanceFlowError("ACCOUNT_STORE_UNAVAILABLE", "素材所有权服务不可用", false);
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
      const asset = accounts.getOwnedAsset(job.ownerUserId, id);
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
        const requestedDuration = Number(job.values.durationSec ?? job.values.duration ?? 5);
        const duration = Math.min(15, Math.max(4, Math.round(requestedDuration))) as
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
        const created = await aihubmix.createSeedanceVideo({
          model,
          prompt:
            job.values.prompt ||
            job.values.topic ||
            job.values.description ||
            "A polished product video in a clean bright studio, stable camera",
          resolution: "720p",
          ratio: job.values.ratio?.startsWith("9:16") ? "9:16" : job.values.ratio?.startsWith("1:1") ? "1:1" : "16:9",
          duration,
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
        const definitelyRejected = error instanceof Error && /AIHUBMIX_4(00|01|03|04|13|22):/.test(error.message);
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
            const state = await aihubmix.cancelVideo(taskId);
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
        let task: Awaited<ReturnType<typeof aihubmix.getVideo>>;
        try {
          task = await aihubmix.getVideo(taskId);
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
}
