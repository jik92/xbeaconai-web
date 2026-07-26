import { providerCredentials } from "../byok/credential-store";
import type { QianchuanAdvertiserSummary, QianchuanDeliveryInput, QianchuanTokenPayload } from "./types";
import { QianchuanUpstreamError } from "./types";

const API_BASE = "https://api.oceanengine.com";

interface Envelope<T> {
  code?: number;
  message?: string;
  request_id?: string;
  data?: T;
}

function configuredApp() {
  const appId = providerCredentials.get("QIANCHUAN_APP_ID")?.trim();
  const secret = providerCredentials.get("QIANCHUAN_APP_SECRET")?.trim();
  if (!appId || !secret) throw new Error("QIANCHUAN_NOT_CONFIGURED");
  return { appId, secret };
}

function retryableCode(code: number) {
  return code === 40100 || code === 50000 || code === 50001 || code === 50002;
}

export class QianchuanClient {
  authorizationUrl(state: string) {
    const { appId } = configuredApp();
    const url = new URL("https://qianchuan.jinritemai.com/openapi/qc/audit/oauth.html");
    url.searchParams.set("app_id", appId);
    url.searchParams.set("state", state);
    url.searchParams.set("material_auth", "1");
    return url.toString();
  }

  private async request<T>(
    path: string,
    options: {
      method?: "GET" | "POST";
      accessToken?: string;
      query?: Record<string, unknown>;
      body?: Record<string, unknown> | FormData;
    } = {},
  ): Promise<{ data: T; requestId: string }> {
    const url = new URL(path, API_BASE);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    const headers = new Headers();
    if (options.accessToken) headers.set("Access-Token", options.accessToken);
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
    });
    let payload: Envelope<T>;
    try {
      payload = (await response.json()) as Envelope<T>;
    } catch {
      payload = { code: response.status, message: "千川接口返回了无法解析的响应" };
    }
    const requestId = payload.request_id ?? response.headers.get("X-Tt-Logid") ?? crypto.randomUUID();
    const code = Number(payload.code ?? response.status);
    if (!response.ok || code !== 0 || !payload.data)
      throw new QianchuanUpstreamError({
        code: `QIANCHUAN_${code}`,
        message: payload.message || "千川接口调用失败",
        retryable: retryableCode(code) || response.status >= 500,
        requestId,
      });
    return { data: payload.data, requestId };
  }

  async exchangeCode(authCode: string): Promise<QianchuanTokenPayload> {
    const { appId, secret } = configuredApp();
    const { data } = await this.request<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      refresh_token_expires_in: number;
      advertiser_ids?: number[];
      auth_user_id?: number;
    }>("/open_api/oauth2/access_token/", {
      method: "POST",
      body: { app_id: Number(appId), secret, auth_code: authCode },
    });
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      refreshTokenExpiresIn: data.refresh_token_expires_in,
      authUserId: String(data.auth_user_id ?? data.advertiser_ids?.[0] ?? crypto.randomUUID()),
    };
  }

  async refreshToken(refreshToken: string): Promise<QianchuanTokenPayload> {
    const { appId, secret } = configuredApp();
    const { data } = await this.request<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      refresh_token_expires_in: number;
      auth_user_id?: number;
    }>("/open_api/oauth2/refresh_token/", {
      method: "POST",
      body: { app_id: Number(appId), secret, refresh_token: refreshToken },
    });
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      refreshTokenExpiresIn: data.refresh_token_expires_in,
      authUserId: String(data.auth_user_id ?? ""),
    };
  }

  async listAuthorizedAdvertisers(accessToken: string): Promise<QianchuanAdvertiserSummary[]> {
    const { appId } = configuredApp();
    const { data } = await this.request<{
      list?: Array<{ advertiser_id: number; advertiser_name?: string; account_role?: string; status?: string }>;
    }>("/open_api/oauth2/advertiser/get/", {
      accessToken,
      query: { app_id: Number(appId) },
    });
    return (data.list ?? []).map((item) => ({
      advertiserId: String(item.advertiser_id),
      name: item.advertiser_name || `千川账户 ${item.advertiser_id}`,
      accountRole: item.account_role || "ADVERTISER",
      status: item.status || "ACTIVE",
    }));
  }

  listProducts(accessToken: string, advertiserId: string) {
    return this.request<{ list?: unknown[]; page_info?: unknown }>("/open_api/v1.0/qianchuan/product/available/get/", {
      accessToken,
      query: { advertiser_id: advertiserId, campaign_scene: "FEED", page: 1, page_size: 100 },
    });
  }

  listAwemeAccounts(accessToken: string, advertiserId: string) {
    return this.request<{ list?: unknown[] }>("/open_api/v1.0/qianchuan/aweme/authorized/get/", {
      accessToken,
      query: { advertiser_id: advertiserId, page: 1, page_size: 100 },
    });
  }

  async uploadMaterial(
    accessToken: string,
    input: { advertiserId: string; filename: string; mimeType: string; contents: Blob; kind: "video" | "image" },
  ) {
    const form = new FormData();
    form.set("advertiser_id", input.advertiserId);
    form.set(input.kind === "video" ? "video_file" : "image_file", input.contents, input.filename);
    form.set("filename", input.filename);
    const path = input.kind === "video" ? "/open_api/2/file/video/ad/" : "/open_api/2/file/image/ad/";
    return this.request<{ video_id?: string; id?: string; image_id?: string }>(path, {
      method: "POST",
      accessToken,
      body: form,
    });
  }

  createCampaign(accessToken: string, input: QianchuanDeliveryInput) {
    return this.request<{ campaign_id: number }>("/open_api/v1.0/qianchuan/campaign/create/", {
      method: "POST",
      accessToken,
      body: {
        advertiser_id: Number(input.advertiserId),
        campaign_name: `${input.name}-计划组`,
        marketing_goal: "VIDEO_PROM_GOODS",
        marketing_scene: "FEED",
        budget_mode: "BUDGET_MODE_DAY",
        budget: input.budget,
      },
    });
  }

  createAd(accessToken: string, campaignId: string, input: QianchuanDeliveryInput) {
    return this.request<{ ad_id: number; creative_id?: number }>("/open_api/v1.0/qianchuan/ad/create/", {
      method: "POST",
      accessToken,
      body: {
        advertiser_id: Number(input.advertiserId),
        campaign_id: Number(campaignId),
        name: input.name,
        marketing_goal: "VIDEO_PROM_GOODS",
        marketing_scene: "FEED",
        aweme_id: Number(input.awemeId),
        product_ids: [Number(input.productId)],
        creative_material_mode: "CUSTOM_CREATIVE",
        creative_list: [
          {
            image_mode: "VIDEO_VERTICAL",
            video_material: {
              video_id: input.videoMaterialId,
              video_cover_id: input.imageMaterialId,
            },
            title_material: { title: input.title },
          },
        ],
        audience: {
          gender: input.gender,
          age: input.age,
          district: "REGION",
          city: input.regions,
        },
        delivery_setting: {
          budget: input.budget,
          budget_mode: "BUDGET_MODE_DAY",
          smart_bid_type: input.roiGoal ? "SMART_BID_CONSERVATIVE" : "SMART_BID_CUSTOM",
          external_action: input.optimizationGoal,
          cpa_bid: input.bid,
          roi_goal: input.roiGoal,
          start_time: input.startTime,
          end_time: input.endTime,
          schedule_time: input.schedule,
          video_schedule_type: "SCHEDULE_FROM_NOW",
        },
      },
    });
  }

  updateAdStatus(accessToken: string, advertiserId: string, adId: string, optStatus: "ENABLE" | "DISABLE") {
    return this.request<Record<string, never>>("/open_api/v1.0/qianchuan/ad/status/update/", {
      method: "POST",
      accessToken,
      body: { advertiser_id: Number(advertiserId), ad_ids: [Number(adId)], opt_status: optStatus },
    });
  }

  getAd(accessToken: string, advertiserId: string, adId: string) {
    return this.request<{ list?: Array<Record<string, unknown>> }>("/open_api/v1.0/qianchuan/ad/get/", {
      accessToken,
      query: { advertiser_id: advertiserId, filtering: { ids: [Number(adId)] }, page: 1, page_size: 10 },
    });
  }

  report(
    accessToken: string,
    advertiserId: string,
    startDate: string,
    endDate: string,
    level: "account" | "campaign" | "material",
  ) {
    const path =
      level === "account"
        ? "/open_api/v1.0/qianchuan/report/advertiser/get/"
        : level === "campaign"
          ? "/open_api/v1.0/qianchuan/report/ad/get/"
          : "/open_api/v1.0/qianchuan/report/material/get/";
    return this.request<{ list?: Array<Record<string, unknown>> }>(path, {
      accessToken,
      query: { advertiser_id: advertiserId, start_date: startDate, end_date: endDate, page: 1, page_size: 100 },
    });
  }
}

export const qianchuanClient = new QianchuanClient();
