import { createHash, createHmac } from "node:crypto";

export interface VolcOpenApiConfig {
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  region: string;
  service: string;
  version: string;
}

export interface VolcOpenApiResponse<Result> {
  ResponseMetadata?: {
    RequestId?: string;
    Error?: { Code?: string; Message?: string };
  };
  Result?: Result;
}

export type VolcOpenApiFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class VolcOpenApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "VolcOpenApiError";
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();

export function buildVolcOpenApiSignedRequest(
  config: VolcOpenApiConfig,
  action: string,
  input: Record<string, unknown>,
  now = new Date(),
) {
  const endpoint = new URL(config.endpoint);
  const body = JSON.stringify(input);
  const xDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const shortDate = xDate.slice(0, 8);
  const payloadHash = sha256(body);
  const canonicalQuery = `Action=${encodeURIComponent(action)}&Version=${encodeURIComponent(config.version)}`;
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
  const credentialScope = `${shortDate}/${config.region}/${config.service}/request`;
  const stringToSign = ["HMAC-SHA256", xDate, credentialScope, sha256(canonicalRequest)].join("\n");
  const dateKey = hmac(config.secretAccessKey, shortDate);
  const regionKey = hmac(dateKey, config.region);
  const serviceKey = hmac(regionKey, config.service);
  const signingKey = hmac(serviceKey, "request");
  const signature = hmac(signingKey, stringToSign).toString("hex");

  return {
    url: new URL(`?${canonicalQuery}`, endpoint),
    init: {
      method: "POST",
      headers: {
        Authorization: [
          `HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}`,
          `SignedHeaders=${signedHeaders}`,
          `Signature=${signature}`,
        ].join(", "),
        "Content-Type": "application/json",
        Host: endpoint.host,
        "X-Content-Sha256": payloadHash,
        "X-Date": xDate,
      },
      body,
    } satisfies RequestInit,
  };
}

export async function callVolcOpenApi<Result>(
  config: VolcOpenApiConfig,
  action: string,
  input: Record<string, unknown>,
  fetcher: VolcOpenApiFetch = fetch,
) {
  const request = buildVolcOpenApiSignedRequest(config, action, input);
  const response = await fetcher(request.url, {
    ...request.init,
    signal: AbortSignal.timeout(60_000),
  });
  const payload = (await response.json().catch(() => undefined)) as VolcOpenApiResponse<Result> | undefined;
  const error = payload?.ResponseMetadata?.Error;
  if (!response.ok || error) {
    throw new VolcOpenApiError(
      error?.Code ?? `HTTP_${response.status}`,
      error?.Message ?? `火山引擎 OpenAPI ${action} 请求失败（HTTP ${response.status}）`,
      payload?.ResponseMetadata?.RequestId,
    );
  }
  return payload?.Result;
}
