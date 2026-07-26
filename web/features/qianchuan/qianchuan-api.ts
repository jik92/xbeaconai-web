import { apiUrl } from "@/api/base-url";
import { getAuthToken } from "@/features/account/auth-context";

export interface QianchuanAdvertiser {
  advertiserId: string;
  name: string;
  accountRole: string;
  status: string;
}

export interface QianchuanBinding {
  id: string;
  authUserId: string;
  subjectName: string;
  subjectType: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  defaultAdvertiserId: string | null;
  status: "active" | "reauthorization_required" | "revoked";
  advertisers: QianchuanAdvertiser[];
}

export interface QianchuanMaterial {
  id: string;
  advertiserId: string;
  assetId: string;
  kind: "video" | "image";
  upstreamMaterialId?: string;
  status: "queued" | "uploading" | "ready" | "failed";
  errorMessage?: string;
  updatedAt: string;
}

export interface QianchuanDelivery {
  id: string;
  advertiserId: string;
  name: string;
  status: string;
  campaignId?: string;
  adId?: string;
  creativeId?: string;
  reportSummary?: Record<string, number>;
  errorMessage?: string;
  updatedAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  if (!token) throw new Error("请先登录");
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(apiUrl(path), { ...init, headers });
  const payload = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || "千川接口请求失败");
  return payload;
}

export const qianchuanApi = {
  config: () => request<{ configured: boolean; appIdMasked?: string; callbackUrl: string }>("/api/qianchuan/config"),
  bindings: () => request<{ bindings: QianchuanBinding[] }>("/api/qianchuan/bindings"),
  startOauth: () => request<{ authorizationUrl: string }>("/api/qianchuan/oauth/start", { method: "POST" }),
  setDefaultAdvertiser: (bindingId: string, advertiserId: string) =>
    request<{ updated: true }>(`/api/qianchuan/bindings/${bindingId}/default-advertiser`, {
      method: "PUT",
      body: JSON.stringify({ advertiserId }),
    }),
  deleteBinding: (bindingId: string) =>
    request<{ deleted: true }>(`/api/qianchuan/bindings/${bindingId}`, { method: "DELETE" }),
  lookups: (bindingId: string, advertiserId: string) =>
    request<{ products: Array<Record<string, unknown>>; awemeAccounts: Array<Record<string, unknown>> }>(
      `/api/qianchuan/lookups?bindingId=${encodeURIComponent(bindingId)}&advertiserId=${encodeURIComponent(advertiserId)}`,
    ),
  materials: (advertiserId?: string) =>
    request<{ materials: QianchuanMaterial[] }>(
      `/api/qianchuan/materials${advertiserId ? `?advertiserId=${encodeURIComponent(advertiserId)}` : ""}`,
    ),
  uploadMaterial: (input: { bindingId: string; advertiserId: string; assetId: string; kind: "video" | "image" }) =>
    request<{ materialId: string; jobId: string }>("/api/qianchuan/materials", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deliveries: () => request<{ deliveries: QianchuanDelivery[] }>("/api/qianchuan/pc-deliveries"),
  createDelivery: (input: Record<string, unknown>) =>
    request<{ delivery: QianchuanDelivery; jobId: string }>("/api/qianchuan/pc-deliveries", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ ...input, confirmed: true }),
    }),
  syncDelivery: (id: string) =>
    request<{ jobId: string }>(`/api/qianchuan/pc-deliveries/${id}/sync`, { method: "POST" }),
  updateStatus: (id: string, enabled: boolean) =>
    request<{ updated: true }>(`/api/qianchuan/pc-deliveries/${id}/status`, {
      method: "POST",
      body: JSON.stringify({ enabled, confirmed: true }),
    }),
  reports: (startDate: string, endDate: string) =>
    request<{ reports: Array<{ id: string; reportDate: string; level: string; metrics: Record<string, number> }> }>(
      `/api/qianchuan/reports?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
    ),
};
