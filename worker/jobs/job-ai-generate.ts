import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, resolve } from "node:path";
import type { MediaAsset } from "../../server/accounts/account-store";
import { type AiGenerateRequest, parseAiGenerateJobValues } from "../../server/creation/ai-generate-contract";
import { getImageModelDefinition } from "../../server/creation/image-models";
import { env } from "../../server/env";
import { isSeedanceModelId } from "../../server/models/video-models";
import { type AihubmixClient, type AihubmixImageResult, aihubmix } from "../../server/providers/aihubmix";
import { ossutils } from "../../server/storage/ossutils";
import type { JobRecord, JobResult, StageProvenance } from "../../server/types";
import { SeedanceFlowError, SeedanceVideoJob } from "./job-seedance-video";
import type { JobHandlerContext, WorkerJobHandler } from "./types";
import { materializeRemoteAsset } from "./video-remix-assets";

type ImageReference = { bytes: Uint8Array; mimeType: string; name: string; url?: string };
type ImageClient = Pick<
  AihubmixClient,
  | "generateImages"
  | "editImages"
  | "generateSeedreamImages"
  | "generateGeminiInteractionImages"
  | "generateGeminiContentImages"
>;
type SeedanceExecutor = Pick<SeedanceVideoJob, "execute">;

interface AiGenerateDependencies {
  imageClient?: ImageClient;
  loadImageReference?: (asset: MediaAsset, tempDir: string) => Promise<ImageReference>;
  stageImageReference?: (
    reference: ImageReference,
    tempDir: string,
    jobId: string,
  ) => Promise<{ url: string; key?: string }>;
  cleanupStagedReference?: (key: string) => Promise<void>;
  seedanceFactory?: (context: JobHandlerContext) => SeedanceExecutor;
  fetchResult?: (url: string) => Promise<Uint8Array>;
}

const imageSize = (ratio: string) => (ratio === "3:2" ? "1536x1024" : ratio === "2:3" ? "1024x1536" : "1024x1024");

async function defaultLoadImageReference(asset: MediaAsset, tempDir: string): Promise<ImageReference> {
  if (!ossutils.configured) throw new Error("TOS_NOT_CONFIGURED");
  const path = await materializeRemoteAsset({
    tempDir,
    asset,
    targetName: `${asset.id}${extname(asset.originalName) || ".bin"}`,
    label: "图片参考素材",
    tosConfigured: true,
    download: (storageKey, filePath) => ossutils.downloadLibraryFile(storageKey, filePath),
  });
  return {
    bytes: new Uint8Array(await Bun.file(path).arrayBuffer()),
    mimeType: asset.mimeType,
    name: asset.originalName,
    url: ossutils.createSignedReadUrl(asset.storageKey, 2 * 60 * 60),
  };
}

async function defaultStageImageReference(reference: ImageReference, tempDir: string, jobId: string) {
  if (!ossutils.configured) throw new Error("TOS_NOT_CONFIGURED");
  const extension = extname(reference.name) || ".bin";
  const path = resolve(tempDir, `${crypto.randomUUID()}${extension}`);
  await Bun.write(path, reference.bytes);
  const sha256 = new Bun.CryptoHasher("sha256").update(reference.bytes).digest("hex");
  const uploaded = await ossutils.putStagedFile({
    filePath: path,
    sizeBytes: reference.bytes.byteLength,
    sha256,
    mimeType: reference.mimeType,
    jobId,
    extension,
  });
  return {
    url: ossutils.createSignedReadUrl(uploaded.key, 2 * 60 * 60),
    key: uploaded.key,
  };
}

async function defaultCleanupStagedReference(key: string) {
  await ossutils.markCleanupReady(key);
  await ossutils.deleteObject(key);
}

async function defaultFetchResult(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`AIHUBMIX_IMAGE_DOWNLOAD_${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function providerError(error: unknown) {
  const message = (error instanceof Error ? error.message : "上游接口失败")
    .replace(/https?:\/\/[^\s"']+/gi, "[REDACTED_URL]")
    .replace(/(?:sk|AIza)[A-Za-z0-9_-]{8,}/g, "[REDACTED_SECRET]")
    .replace(/\s+/g, " ")
    .slice(0, 500);
  return {
    code: error instanceof SeedanceFlowError ? error.code : "PROVIDER_ERROR",
    message,
    retryable: error instanceof SeedanceFlowError ? error.retryable : true,
    requestId: crypto.randomUUID(),
  };
}

function completeResult(
  context: JobHandlerContext,
  job: JobRecord,
  provenance: StageProvenance[],
  artifacts: NonNullable<JobResult["artifacts"]>,
) {
  const result: JobResult = {
    kind: "ai-generate",
    title: job.title,
    summary: "创作内容已按指令生成，可继续追问或创建变体。",
    artifacts,
    data: {
      values: job.values,
      generatedAt: new Date().toISOString(),
      mock: false,
    },
  };
  context.change(job.id, {
    status: "succeeded",
    stage: "已完成",
    progress: 100,
    provenance,
    result,
    overallExecutionMode: "real",
  });
  const owner = context.accounts?.getUser(job.ownerUserId);
  if (owner && context.accounts?.taskNotificationsEnabled(job.ownerUserId))
    context.accounts.createNotification(
      job.ownerUserId,
      "task_completed",
      "创作任务已完成",
      `${job.title} 已生成，可前往任务中心查看。`,
      job.id,
    );
}

export function createAiGenerateJob(dependencies: AiGenerateDependencies = {}): WorkerJobHandler {
  const imageClient = dependencies.imageClient ?? aihubmix;
  const loadImageReference = dependencies.loadImageReference ?? defaultLoadImageReference;
  const stageImageReference = dependencies.stageImageReference ?? defaultStageImageReference;
  const cleanupStagedReference = dependencies.cleanupStagedReference ?? defaultCleanupStagedReference;
  const seedanceFactory = dependencies.seedanceFactory ?? ((context) => new SeedanceVideoJob(context));
  const fetchResult = dependencies.fetchResult ?? defaultFetchResult;
  return {
    name: "ai-generate",
    supports: (job) => job.moduleId === "ai-generate",
    async execute(initialJob, context) {
      const { accounts } = context;
      if (!accounts) throw new Error("ACCOUNT_STORE_UNAVAILABLE");
      if (context.store.get(initialJob.id)?.cancelRequested) {
        context.change(initialJob.id, { status: "cancelled", stage: "已取消", error: undefined });
        return;
      }
      let request: AiGenerateRequest;
      try {
        request = parseAiGenerateJobValues(initialJob.values);
      } catch (error) {
        context.change(initialJob.id, {
          status: "failed",
          stage: "参数校验失败",
          error: {
            code: "INVALID_AI_GENERATE_CONFIG",
            message: error instanceof Error ? error.message : "AI 创作参数无效",
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        });
        return;
      }
      if (initialJob.values.allowMockFallback !== "false") {
        context.change(initialJob.id, {
          status: "failed",
          stage: "真实能力校验失败",
          error: {
            code: "MOCK_FALLBACK_FORBIDDEN",
            message: "AI 创作专用任务禁止 Mock 降级",
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        });
        return;
      }
      const imageDefinition = request.kind === "image" ? getImageModelDefinition(request.modelId) : undefined;
      if (request.kind === "image" && !imageDefinition) {
        context.change(initialJob.id, {
          status: "failed",
          stage: "参数校验失败",
          error: {
            code: "INVALID_IMAGE_MODEL",
            message: "所选图片模型不存在",
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        });
        return;
      }
      const stage: StageProvenance = {
        id: `${initialJob.id}:generate`,
        capability: request.kind === "image" ? "image-generate" : "video-generate",
        executionMode: "real",
        implementation: imageDefinition?.protocol ?? "ark-seedance-video",
        provider: request.kind === "image" ? "aihubmix" : "ark",
        model: imageDefinition?.providerModel ?? request.modelId,
        startedAt: new Date().toISOString(),
      };
      context.change(initialJob.id, {
        status: "processing",
        stage: request.kind === "image" ? "生成图片" : "生成视频",
        progress: 10,
        provenance: [stage],
        overallExecutionMode: "real",
      });
      try {
        if (request.kind === "video") {
          if (!isSeedanceModelId(request.modelId))
            throw new SeedanceFlowError("INVALID_VIDEO_MODEL", "视频模型无效", false);
          const response = await seedanceFactory(context).execute(initialJob, request.modelId);
          if (response.executionMode !== "real")
            throw new SeedanceFlowError("REAL_PROVIDER_UNAVAILABLE", "Seedance 未返回真实生成结果", false);
          const name = `${initialJob.id}-video.mp4`;
          await Bun.write(resolve(env.dataDir, "results", name), response.bytes);
          const artifactId = crypto.randomUUID();
          accounts.createArtifact({
            id: artifactId,
            ownerUserId: initialJob.ownerUserId,
            jobId: initialJob.id,
            storageKey: name,
            name,
            mimeType: response.mimeType,
            createdAt: new Date().toISOString(),
          });
          const completedStage = {
            ...stage,
            implementation: response.implementation,
            completedAt: new Date().toISOString(),
          };
          completeResult(
            context,
            initialJob,
            [completedStage],
            [
              {
                id: artifactId,
                name,
                mimeType: response.mimeType,
                url: `/api/artifacts/${artifactId}`,
                executionMode: "real",
                lineage: [completedStage],
              },
            ],
          );
          return;
        }

        const tempDir = await mkdtemp(resolve(tmpdir(), "yaozuo-ai-generate-images-"));
        const stagedKeys: string[] = [];
        try {
          const references: ImageReference[] = [];
          for (const assetId of request.referenceAssetIds) {
            const asset = accounts.getOwnedAsset(initialJob.ownerUserId, assetId);
            if (!asset) throw new Error("ASSET_NOT_AVAILABLE");
            if (!asset.mimeType.startsWith("image/")) throw new Error("UNSUPPORTED_REFERENCE_TYPE");
            if (asset.byteSize > 20 * 1024 * 1024) throw new Error("REFERENCE_TOO_LARGE");
            references.push(await loadImageReference(asset, tempDir));
          }
          if (!references.length && request.revisionMode !== "new" && initialJob.parentJobId) {
            const parent = context.store.getOwned(initialJob.parentJobId, initialJob.ownerUserId);
            const artifact = parent?.result?.artifacts.find((item) => item.mimeType.startsWith("image/"));
            const path = artifact ? resolve(env.dataDir, "results", basename(artifact.name)) : undefined;
            if (artifact && path && existsSync(path))
              references.push({
                bytes: new Uint8Array(await Bun.file(path).arrayBuffer()),
                mimeType: artifact.mimeType,
                name: artifact.name,
              });
          }
          if (!imageDefinition) throw new Error("INVALID_IMAGE_MODEL");
          if (context.store.get(initialJob.id)?.cancelRequested)
            throw new SeedanceFlowError("JOB_CANCELLED", "任务已取消", false);
          let responses: AihubmixImageResult[];
          switch (imageDefinition.protocol) {
            case "openai-images": {
              const input = {
                prompt: request.prompt,
                model: imageDefinition.providerModel,
                size: imageSize(request.ratio),
                count: request.count,
                quality: "low",
              };
              responses = references.length
                ? await imageClient.editImages({ ...input, images: references })
                : await imageClient.generateImages(input);
              break;
            }
            case "aihubmix-predictions":
              for (const reference of references) {
                if (reference.url) continue;
                const staged = await stageImageReference(reference, tempDir, initialJob.id);
                reference.url = staged.url;
                if (staged.key) {
                  stagedKeys.push(staged.key);
                  const current = context.store.get(initialJob.id);
                  if (current) context.change(initialJob.id, { stagingKeys: [...current.stagingKeys, staged.key] });
                }
              }
              responses = await imageClient.generateSeedreamImages({
                prompt: request.prompt,
                model: imageDefinition.providerModel,
                size: request.resolution.toUpperCase(),
                count: request.count,
                imageUrls: references.map((reference) => {
                  if (!reference.url) throw new Error("SEEDREAM_REFERENCE_URL_UNAVAILABLE");
                  return reference.url;
                }),
              });
              break;
            case "gemini-interactions":
              responses = await imageClient.generateGeminiInteractionImages({
                prompt: request.prompt,
                model: imageDefinition.providerModel,
                aspectRatio: request.ratio,
                imageSize: request.resolution.toUpperCase() as "1K" | "2K" | "4K",
                images: references,
              });
              break;
            case "gemini-content":
              responses = await imageClient.generateGeminiContentImages({
                prompt: request.prompt,
                model: imageDefinition.providerModel,
                aspectRatio: request.ratio,
                imageSize: request.resolution.toUpperCase() as "1K" | "2K" | "4K",
                images: references,
              });
              break;
          }
          if (context.store.get(initialJob.id)?.cancelRequested)
            throw new SeedanceFlowError("JOB_CANCELLED", "任务已取消", false);
          const artifacts: NonNullable<JobResult["artifacts"]> = [];
          for (const [index, response] of responses.entries()) {
            const item = response as AihubmixImageResult;
            const bytes = item.b64Json
              ? new Uint8Array(Buffer.from(item.b64Json, "base64"))
              : item.url
                ? await fetchResult(item.url)
                : undefined;
            if (!bytes?.byteLength) throw new Error("AIHUBMIX_INVALID_IMAGE_RESULT");
            const mimeType = item.mimeType ?? "image/png";
            const extension = mimeType === "image/webp" ? "webp" : mimeType === "image/jpeg" ? "jpg" : "png";
            const name = `${initialJob.id}-image-${index + 1}.${extension}`;
            await Bun.write(resolve(env.dataDir, "results", name), bytes);
            const artifactId = crypto.randomUUID();
            accounts.createArtifact({
              id: artifactId,
              ownerUserId: initialJob.ownerUserId,
              jobId: initialJob.id,
              storageKey: name,
              name,
              mimeType,
              createdAt: new Date().toISOString(),
            });
            artifacts.push({
              id: artifactId,
              name,
              mimeType,
              url: `/api/artifacts/${artifactId}`,
              executionMode: "real",
              lineage: [],
            });
          }
          const completedStage = { ...stage, completedAt: new Date().toISOString() };
          for (const artifact of artifacts) artifact.lineage = [completedStage];
          completeResult(context, initialJob, [completedStage], artifacts);
        } finally {
          for (const key of stagedKeys) {
            try {
              await cleanupStagedReference(key);
              const current = context.store.get(initialJob.id);
              if (current)
                context.change(initialJob.id, {
                  stagingKeys: current.stagingKeys.filter((item) => item !== key),
                });
            } catch (error) {
              context.store.scheduleObjectCleanup(initialJob.id, key, error);
            }
          }
          await rm(tempDir, { recursive: true, force: true });
        }
      } catch (error) {
        if (error instanceof SeedanceFlowError && error.code === "JOB_CANCELLED") {
          context.change(initialJob.id, { status: "cancelled", stage: "已取消", error: undefined });
          return;
        }
        context.change(initialJob.id, {
          status: "failed",
          stage: request.kind === "image" ? "图片生成失败" : "视频生成失败",
          provenance: [{ ...stage, completedAt: new Date().toISOString() }],
          error: providerError(error),
          overallExecutionMode: "real",
        });
      }
    },
  };
}

export const aiGenerateJob = createAiGenerateJob();
