import { isAbsolute, relative, resolve } from "node:path";
import { env } from "../../server/env";
import { ArkAssetsError, arkAssets } from "../../server/providers/ark-assets";
import { ossutils } from "../../server/storage/ossutils";
import type { StageProvenance } from "../../server/types";
import type { WorkerJobHandler } from "./types";

const wait = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function resolvePortraitGroup(
  ownerUserId: string,
  jobId: string,
  context: Parameters<WorkerJobHandler["execute"]>[1],
) {
  const portraits = context.customPortraits;
  if (!portraits) throw new Error("CUSTOM_PORTRAIT_STORE_UNAVAILABLE");
  const current = portraits.getGroup(ownerUserId);
  if (current?.status === "active" && current.groupId) return current;
  const claim = portraits.claimGroupCreation(ownerUserId, jobId);
  if (claim.claimed) {
    try {
      const created = await arkAssets.createAssetGroup({
        name: `yaozuo-${ownerUserId.slice(0, 8)}`,
        description: "烽火AI自建虚拟人像",
        projectName: "default",
      });
      const active = portraits.activateGroup(ownerUserId, jobId, created.Id);
      if (!active?.groupId) throw new Error("ARK_PORTRAIT_GROUP_PERSIST_FAILED");
      return active;
    } catch (error) {
      portraits.failGroup(ownerUserId, jobId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  const started = Date.now();
  while (Date.now() - started < 2 * 60_000) {
    const group = portraits.getGroup(ownerUserId);
    if (group?.status === "active" && group.groupId) return group;
    if (group?.status === "failed") throw new Error(`ARK_PORTRAIT_GROUP_FAILED:${group.errorMessage ?? "unknown"}`);
    await wait(1_000);
  }
  throw new Error("ARK_PORTRAIT_GROUP_TIMEOUT");
}

export const portraitAssetRegisterJob: WorkerJobHandler = {
  name: "portrait-asset-register",
  supports: (job) => job.moduleId === "portrait-asset-register",
  async execute(job, context) {
    const portraits = context.customPortraits;
    const accounts = context.accounts;
    if (!portraits || !accounts) throw new Error("CUSTOM_PORTRAIT_SERVICES_UNAVAILABLE");
    if (!arkAssets.configured) throw new Error("ARK_ASSETS_NOT_CONFIGURED");
    if (!ossutils.configured) throw new Error("TOS_NOT_CONFIGURED");
    const assetId = job.values.assetId;
    const asset = accounts.getOwnedAsset(job.ownerUserId, assetId);
    const portrait = portraits.getOwned(job.ownerUserId, assetId);
    if (!asset || asset.kind !== "portrait" || !asset.mimeType.startsWith("image/") || !portrait)
      throw new Error("CUSTOM_PORTRAIT_NOT_AVAILABLE");

    const stage: StageProvenance = {
      id: `${job.id}:portrait-asset-register`,
      capability: "portrait-asset-register",
      executionMode: "real" as const,
      implementation: "ark-assets",
      provider: "ark",
      startedAt: new Date().toISOString(),
    };
    context.change(job.id, {
      status: "processing",
      stage: "创建虚拟人像",
      progress: 5,
      provenance: [stage],
      overallExecutionMode: "real",
    });
    portraits.update(assetId, { status: "processing", errorCode: null, errorMessage: null });

    try {
      const group = await resolvePortraitGroup(job.ownerUserId, job.id, context);
      context.change(job.id, { stage: "上传人像素材", progress: 20 });
      const uploadRoot = resolve(env.dataDir, "uploads");
      const localPath = resolve(uploadRoot, asset.storageKey);
      const relativePath = relative(uploadRoot, localPath);
      if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath))
        throw new Error("INVALID_PORTRAIT_ASSET_PATH");
      const file = Bun.file(localPath);
      if (!(await file.exists()) || file.size !== asset.byteSize) throw new Error("PORTRAIT_SOURCE_FILE_NOT_FOUND");
      await ossutils.putLibraryFile({
        filePath: localPath,
        key: asset.storageKey,
        mimeType: asset.mimeType,
        sizeBytes: asset.byteSize,
      });

      let arkAssetId = portrait.arkAssetId ?? job.providerTaskId;
      if (!arkAssetId) {
        if (job.providerStatus === "submitting") throw new Error("PROVIDER_SUBMISSION_UNKNOWN");
        context.change(job.id, { providerStatus: "submitting", stage: "提交 Ark 虚拟资产", progress: 35 });
        const created = await arkAssets.createAsset({
          groupId: group.groupId!,
          url: ossutils.createSignedReadUrl(asset.storageKey),
          name: asset.displayName.slice(0, 80),
          assetType: "Image",
          projectName: group.projectName,
        });
        arkAssetId = created.Id;
        portraits.update(assetId, { groupId: group.groupId, arkAssetId, status: "processing" });
        context.change(job.id, {
          providerTaskId: arkAssetId,
          providerStatus: "Processing",
          providerSubmittedAt: new Date().toISOString(),
          stage: "处理虚拟人像",
          progress: 50,
        });
      }

      const active = await arkAssets.waitForAsset(arkAssetId, group.projectName);
      portraits.update(assetId, {
        groupId: group.groupId,
        arkAssetId,
        status: "active",
        errorCode: null,
        errorMessage: null,
      });
      stage.completedAt = new Date().toISOString();
      context.change(job.id, {
        status: "succeeded",
        stage: "已完成",
        progress: 100,
        providerStatus: active.Status,
        provenance: [stage],
        result: {
          kind: "custom-portrait",
          title: asset.displayName,
          summary: "自建虚拟人像已可用于 Seedance 生成",
          artifacts: [],
          data: { values: job.values, generatedAt: new Date().toISOString(), mock: false },
        },
      });
    } catch (error) {
      const code = error instanceof ArkAssetsError ? error.code : "CUSTOM_PORTRAIT_REGISTRATION_FAILED";
      const message = error instanceof Error ? error.message : "自建虚拟人像创建失败";
      portraits.update(assetId, { status: "failed", errorCode: code, errorMessage: message.slice(0, 500) });
      context.change(job.id, {
        status: "failed",
        stage: "创建失败",
        error: { code, message, retryable: true, requestId: crypto.randomUUID() },
      });
    }
  },
};
