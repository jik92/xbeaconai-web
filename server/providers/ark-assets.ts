import { createHash, createHmac } from "node:crypto";
import { providerCredentials } from "../byok/credential-store";
import { env } from "../env";

const DEFAULT_ENDPOINT = "https://ark.cn-beijing.volcengineapi.com";
const API_VERSION = "2024-01-01";
const SERVICE = "ark";
const REGION = "cn-beijing";

export interface ArkAssetsConfig {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
}

export interface ArkAssetGroupInput {
  name: string;
  description?: string;
  projectName?: string;
}

export interface ArkAssetInput {
  groupId: string;
  url: string;
  name: string;
  assetType: "Image" | "Video" | "Audio";
  projectName?: string;
}

export interface ArkAsset {
  Id: string;
  Name?: string;
  URL?: string;
  AssetType?: "Image" | "Video" | "Audio";
  GroupId?: string;
  Status: "Processing" | "Active" | "Failed" | string;
  Error?: { Code?: string; Message?: string };
  ProjectName?: string;
  CreateTime?: string;
  UpdateTime?: string;
}

interface ArkOpenApiResponse<Result> {
  ResponseMetadata?: {
    RequestId?: string;
    Error?: { Code?: string; Message?: string };
  };
  Result?: Result;
}

export type ArkAssetsFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class ArkAssetsError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ArkAssetsError";
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();

export function buildArkAssetsSignedRequest(
  config: ArkAssetsConfig,
  action: string,
  input: Record<string, unknown>,
  now = new Date(),
) {
  const endpoint = new URL(config.endpoint ?? DEFAULT_ENDPOINT);
  const body = JSON.stringify(input);
  const xDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const shortDate = xDate.slice(0, 8);
  const payloadHash = sha256(body);
  const canonicalQuery = `Action=${encodeURIComponent(action)}&Version=${API_VERSION}`;
  const canonicalHeaders = [
    "content-type:application/json",
    `host:${endpoint.host}`,
    `x-content-sha256:${payloadHash}`,
    `x-date:${xDate}`,
    "",
  ].join("\n");
  const signedHeaders = "content-type;host;x-content-sha256;x-date";
  const canonicalRequest = [
    "POST",
    endpoint.pathname || "/",
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${shortDate}/${REGION}/${SERVICE}/request`;
  const stringToSign = ["HMAC-SHA256", xDate, credentialScope, sha256(canonicalRequest)].join("\n");
  const dateKey = hmac(config.secretAccessKey, shortDate);
  const regionKey = hmac(dateKey, REGION);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, "request");
  const signature = hmac(signingKey, stringToSign).toString("hex");
  const authorization = [
    `HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  return {
    url: new URL(`?${canonicalQuery}`, endpoint),
    init: {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        Host: endpoint.host,
        "X-Content-Sha256": payloadHash,
        "X-Date": xDate,
      },
      body,
    } satisfies RequestInit,
  };
}

export class ArkAssetsClient {
  constructor(
    private readonly configuredConfig?: ArkAssetsConfig,
    private readonly fetcher: ArkAssetsFetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private get config(): ArkAssetsConfig {
    return (
      this.configuredConfig ?? {
        accessKeyId: providerCredentials.get("TOS_ACCESS_KEY_ID") ?? "",
        secretAccessKey: providerCredentials.get("TOS_SECRET_ACCESS_KEY") ?? "",
      }
    );
  }

  get configured() {
    const config = this.config;
    return Boolean(config.accessKeyId && config.secretAccessKey);
  }

  private async request<Result>(action: string, input: Record<string, unknown>, retryable = false) {
    const config = this.config;
    if (!config.accessKeyId || !config.secretAccessKey) throw new Error("ARK_ASSETS_NOT_CONFIGURED");
    if (env.blockAiOutbound) throw new Error(`AI_OUTBOUND_BLOCKED:${action}`);
    const attempts = retryable ? 4 : 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const request = buildArkAssetsSignedRequest(config, action, input, this.now());
        const response = await this.fetcher(request.url, {
          ...request.init,
          signal: AbortSignal.timeout(120_000),
        });
        const payload = (await response.json().catch(() => undefined)) as ArkOpenApiResponse<Result> | undefined;
        const upstreamError = payload?.ResponseMetadata?.Error;
        if (!response.ok || upstreamError) {
          const error = new ArkAssetsError(
            upstreamError?.Code ?? `HTTP_${response.status}`,
            upstreamError?.Message ?? `Ark Assets 请求失败（HTTP ${response.status}）`,
            payload?.ResponseMetadata?.RequestId,
          );
          const retryableStatus = [408, 429, 500, 502, 503, 504].includes(response.status);
          if (!retryable || !retryableStatus) throw error;
          lastError = error;
        } else if (!payload?.Result) {
          throw new ArkAssetsError("INVALID_RESPONSE", "Ark Assets 响应缺少 Result");
        } else {
          return payload.Result;
        }
      } catch (error) {
        lastError = error;
        const retryableHttpError =
          error instanceof ArkAssetsError &&
          ["HTTP_408", "HTTP_429", "HTTP_500", "HTTP_502", "HTTP_503", "HTTP_504"].includes(error.code);
        if (!retryable || (error instanceof ArkAssetsError && !retryableHttpError) || attempt === attempts - 1)
          throw error;
      }
      await Bun.sleep(500 * 2 ** attempt);
    }
    throw lastError;
  }

  createAssetGroup(input: ArkAssetGroupInput) {
    return this.request<{ Id: string }>("CreateAssetGroup", {
      Name: input.name,
      Description: input.description ?? "",
      GroupType: "AIGC",
      ProjectName: input.projectName ?? "default",
    });
  }

  createAsset(input: ArkAssetInput) {
    return this.request<{ Id: string }>("CreateAsset", {
      GroupId: input.groupId,
      URL: input.url,
      Name: input.name,
      AssetType: input.assetType,
      ProjectName: input.projectName ?? "default",
    });
  }

  getAsset(id: string, projectName = "default") {
    return this.request<ArkAsset>("GetAsset", { Id: id, ProjectName: projectName }, true);
  }

  deleteAsset(id: string, projectName = "default") {
    return this.request<Record<string, never>>("DeleteAsset", { Id: id, ProjectName: projectName });
  }

  deleteAssetGroup(id: string, projectName = "default") {
    return this.request<Record<string, never>>("DeleteAssetGroup", { Id: id, ProjectName: projectName });
  }

  async waitForAsset(id: string, projectName = "default", timeoutMs = 30 * 60_000, pollIntervalMs = 10_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const asset = await this.getAsset(id, projectName);
      if (asset.Status === "Active") return asset;
      if (asset.Status === "Failed")
        throw new ArkAssetsError(
          asset.Error?.Code ?? "ASSET_PROCESSING_FAILED",
          asset.Error?.Message ?? "Ark 素材处理失败",
        );
      await Bun.sleep(pollIntervalMs);
    }
    throw new ArkAssetsError("ASSET_PROCESSING_TIMEOUT", "Ark 素材处理超时");
  }
}

export const arkAssets = new ArkAssetsClient();
