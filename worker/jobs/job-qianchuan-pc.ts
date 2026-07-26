import { qianchuanClient } from "../../server/qianchuan/client";
import { qianchuanStore } from "../../server/qianchuan/store";
import type { QianchuanDeliveryInput } from "../../server/qianchuan/types";
import { QianchuanUpstreamError } from "../../server/qianchuan/types";
import { ossutils } from "../../server/storage/ossutils";
import type { WorkerJobHandler } from "./types";

function fail(jobId: string, context: Parameters<WorkerJobHandler["execute"]>[1], error: unknown) {
  const detail =
    error instanceof QianchuanUpstreamError
      ? error.detail
      : {
          code: "QIANCHUAN_JOB_FAILED",
          message: error instanceof Error ? error.message : "千川任务执行失败",
          retryable: false,
          requestId: crypto.randomUUID(),
        };
  context.change(jobId, { status: "failed", stage: "执行失败", error: detail });
  return detail;
}

async function bindingAccessToken(ownerUserId: string, bindingId: string) {
  let binding = qianchuanStore.getOwnedBinding(ownerUserId, bindingId);
  if (!binding || binding.status !== "active") throw new Error("QIANCHUAN_BINDING_UNAVAILABLE");
  if (Date.parse(binding.accessTokenExpiresAt) <= Date.now() + 5 * 60_000) {
    if (Date.parse(binding.refreshTokenExpiresAt) <= Date.now()) throw new Error("QIANCHUAN_REAUTHORIZATION_REQUIRED");
    const refreshed = await qianchuanClient.refreshToken(qianchuanStore.refreshToken(binding));
    binding =
      qianchuanStore.upsertBinding(ownerUserId, {
        ...refreshed,
        authUserId: refreshed.authUserId || binding.authUserId,
      }) ?? binding;
  }
  return { binding, accessToken: qianchuanStore.accessToken(binding) };
}

export const qianchuanPcJob: WorkerJobHandler = {
  name: "qianchuan-pc",
  supports: (job) =>
    job.moduleId === "qianchuan-material-upload" ||
    job.moduleId === "qianchuan-pc-submit" ||
    job.moduleId === "qianchuan-pc-sync",
  async execute(job, context) {
    if (job.moduleId === "qianchuan-material-upload") {
      const material = qianchuanStore.getMaterial(job.values.materialId);
      const asset = material && context.accounts?.getOwnedAsset(job.ownerUserId, material.assetId);
      if (!material || !asset || material.ownerUserId !== job.ownerUserId) {
        fail(job.id, context, new Error("QIANCHUAN_MATERIAL_NOT_FOUND"));
        return;
      }
      try {
        context.change(job.id, { status: "processing", stage: "上传千川素材", progress: 15 });
        qianchuanStore.updateMaterial(material.id, { status: "uploading", errorMessage: null });
        const { accessToken } = await bindingAccessToken(job.ownerUserId, material.bindingId);
        const source = await fetch(ossutils.createSignedReadUrl(asset.storageKey), {
          signal: AbortSignal.timeout(10 * 60_000),
        });
        if (!source.ok) throw new Error("QIANCHUAN_SOURCE_DOWNLOAD_FAILED");
        const uploaded = await qianchuanClient.uploadMaterial(accessToken, {
          advertiserId: material.advertiserId,
          filename: asset.originalName,
          mimeType: asset.mimeType,
          contents: await source.blob(),
          kind: material.kind,
        });
        const upstreamMaterialId = uploaded.data.video_id ?? uploaded.data.image_id ?? uploaded.data.id;
        if (!upstreamMaterialId) throw new Error("QIANCHUAN_MATERIAL_ID_MISSING");
        qianchuanStore.updateMaterial(material.id, {
          status: "ready",
          upstreamMaterialId,
          requestId: uploaded.requestId,
          errorMessage: null,
        });
        context.change(job.id, {
          status: "succeeded",
          stage: "已上传",
          progress: 100,
          providerTaskId: upstreamMaterialId,
          providerStatus: "READY",
          result: {
            kind: "qianchuan-material",
            title: asset.displayName,
            summary: "素材已上传到千川账户",
            artifacts: [],
            data: { values: job.values, generatedAt: new Date().toISOString(), mock: false },
          },
        });
      } catch (error) {
        const detail = fail(job.id, context, error);
        qianchuanStore.updateMaterial(material.id, { status: "failed", errorMessage: detail.message });
      }
      return;
    }

    const delivery = qianchuanStore.getOwnedDelivery(job.ownerUserId, job.values.deliveryId);
    if (!delivery) {
      fail(job.id, context, new Error("QIANCHUAN_DELIVERY_NOT_FOUND"));
      return;
    }
    const input = delivery.requestPayload as unknown as QianchuanDeliveryInput;
    try {
      const { accessToken } = await bindingAccessToken(job.ownerUserId, delivery.bindingId);
      if (job.moduleId === "qianchuan-pc-submit") {
        context.change(job.id, { status: "processing", stage: "创建千川计划组", progress: 15 });
        qianchuanStore.updateDelivery(delivery.id, { status: "submitting", errorMessage: null });
        let campaignId = delivery.campaignId;
        let requestId = delivery.requestId;
        if (!campaignId) {
          const campaign = await qianchuanClient.createCampaign(accessToken, input);
          campaignId = String(campaign.data.campaign_id);
          requestId = campaign.requestId;
          qianchuanStore.updateDelivery(delivery.id, { campaignId, requestId });
        }
        context.change(job.id, { stage: "创建千川计划与创意", progress: 55, providerTaskId: campaignId });
        let adId = delivery.adId;
        let creativeId = delivery.creativeId;
        if (!adId) {
          const ad = await qianchuanClient.createAd(accessToken, campaignId, input);
          adId = String(ad.data.ad_id);
          creativeId = ad.data.creative_id ? String(ad.data.creative_id) : undefined;
          requestId = ad.requestId;
          qianchuanStore.updateDelivery(delivery.id, { adId, creativeId, requestId });
        }
        await qianchuanClient.updateAdStatus(accessToken, delivery.advertiserId, adId, "DISABLE");
        qianchuanStore.updateDelivery(delivery.id, { status: "paused", campaignId, adId, creativeId, requestId });
        context.change(job.id, {
          status: "succeeded",
          stage: "已创建并暂停",
          progress: 100,
          providerTaskId: adId,
          providerStatus: "DISABLE",
          result: {
            kind: "qianchuan-pc-delivery",
            title: delivery.name,
            summary: "计划组、计划和创意已创建，当前为暂停状态",
            artifacts: [],
            data: { values: job.values, generatedAt: new Date().toISOString(), mock: false },
          },
        });
        return;
      }

      context.change(job.id, { status: "processing", stage: "同步千川状态", progress: 20 });
      if (delivery.adId) {
        const ad = await qianchuanClient.getAd(accessToken, delivery.advertiserId, delivery.adId);
        const row = ad.data.list?.[0] ?? {};
        const upstreamStatus = String(row.status ?? row.opt_status ?? "");
        const status = /REJECT/i.test(upstreamStatus)
          ? "rejected"
          : /ENABLE|DELIVERY_OK/i.test(upstreamStatus)
            ? "active"
            : /AUDIT|REVIEW/i.test(upstreamStatus)
              ? "reviewing"
              : "paused";
        qianchuanStore.updateDelivery(delivery.id, { status });
      }
      const today = new Date().toISOString().slice(0, 10);
      for (const level of ["account", "campaign", "material"] as const) {
        const report = await qianchuanClient.report(accessToken, delivery.advertiserId, today, today, level);
        const first = report.data.list?.[0] ?? {};
        const metrics = Object.fromEntries(
          Object.entries(first).flatMap(([key, value]) => {
            const number = Number(value);
            return Number.isFinite(number) ? [[key, number]] : [];
          }),
        );
        qianchuanStore.upsertReport(job.ownerUserId, delivery.id, today, level, metrics);
      }
      context.change(job.id, {
        status: "succeeded",
        stage: "同步完成",
        progress: 100,
        result: {
          kind: "qianchuan-pc-sync",
          title: delivery.name,
          summary: "审核状态和今日报表已同步",
          artifacts: [],
          data: { values: job.values, generatedAt: new Date().toISOString(), mock: false },
        },
      });
    } catch (error) {
      const detail = fail(job.id, context, error);
      qianchuanStore.updateDelivery(delivery.id, { status: "failed", errorMessage: detail.message });
    }
  },
};
