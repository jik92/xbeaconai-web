import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import TosClient, { ACLType, HttpMethodType } from "@volcengine/tos-sdk";

const EXPECTED_REGION = "cn-shanghai";
const EXPECTED_BUCKET = "xbeacon-shanghai";
const APP_ORIGIN = "https://app.xbeaconai.com";
const REQUIRED_METHODS = [HttpMethodType.HttpMethodGet, HttpMethodType.HttpMethodHead, HttpMethodType.HttpMethodPut];
const EXPOSE_HEADERS = [
  "ETag",
  "Accept-Ranges",
  "Content-Length",
  "Content-Range",
  "Content-Type",
  "x-tos-request-id",
  "x-tos-hash-crc64ecma",
];

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 未配置`);
  return value;
}

export function parseCorsOrigins(value: string) {
  const origins = [
    ...new Set(
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  ];
  for (const origin of origins) {
    const url = new URL(origin);
    if (origin.includes("*") || !(["http:", "https:"].includes(url.protocol) && url.origin === origin))
      throw new Error(`无效的 TOS CORS Origin：${origin}`);
  }
  return origins.sort();
}

export function canonicalCorsRule(origins: string[]) {
  return {
    AllowedOrigins: [...origins].sort(),
    AllowedMethods: REQUIRED_METHODS,
    AllowedHeaders: ["*"],
    ExposeHeaders: EXPOSE_HEADERS,
    MaxAgeSeconds: 3600,
    ResponseVary: true,
  };
}

export function corsRulesMatch(
  rules: Array<{
    AllowedOrigins: string[];
    AllowedMethods: string[];
    AllowedHeaders: string[];
    ExposeHeaders: string[];
    MaxAgeSeconds: number;
    ResponseVary?: boolean;
  }>,
  origins: string[],
) {
  if (rules.length !== 1) return false;
  const expected = canonicalCorsRule(origins);
  const actual = rules[0];
  return (
    JSON.stringify([...actual.AllowedOrigins].sort()) === JSON.stringify(expected.AllowedOrigins) &&
    JSON.stringify([...actual.AllowedMethods].sort()) === JSON.stringify([...expected.AllowedMethods].sort()) &&
    JSON.stringify([...actual.AllowedHeaders].sort()) === JSON.stringify(expected.AllowedHeaders) &&
    JSON.stringify([...actual.ExposeHeaders].sort()) === JSON.stringify([...expected.ExposeHeaders].sort()) &&
    actual.MaxAgeSeconds === expected.MaxAgeSeconds &&
    actual.ResponseVary === true
  );
}

function createClient(endpoint: string) {
  return new TosClient({
    accessKeyId: required("TOS_ACCESS_KEY_ID"),
    accessKeySecret: required("TOS_SECRET_ACCESS_KEY"),
    region: required("TOS_REGION"),
    endpoint,
    secure: true,
    requestTimeout: 60_000,
    connectionTimeout: 15_000,
    maxRetryCount: 2,
  });
}

function assertProductionConfiguration() {
  const region = required("TOS_REGION");
  const bucket = required("TOS_BUCKET");
  const serverEndpoint = required("TOS_SERVER_ENDPOINT");
  const publicEndpoint = required("TOS_PUBLIC_ENDPOINT");
  if (region !== EXPECTED_REGION) throw new Error(`拒绝修改非生产地域：${region}`);
  if (bucket !== EXPECTED_BUCKET) throw new Error(`拒绝修改非生产素材 Bucket：${bucket}`);
  if (serverEndpoint !== `tos-${region}.ivolces.com`)
    throw new Error(`生产 TOS 服务端 Endpoint 错误：${serverEndpoint}`);
  if (publicEndpoint !== `tos-${region}.volces.com`) throw new Error(`生产 TOS 公网 Endpoint 错误：${publicEndpoint}`);
  return { bucket, serverEndpoint, publicEndpoint };
}

async function configureCors(client: TosClient, bucket: string, origins: string[]) {
  await client.putBucketCORS({ bucket, CORSRules: [canonicalCorsRule(origins)] });
  const rules = (await client.getBucketCORS({ bucket })).data.CORSRules ?? [];
  if (!corsRulesMatch(rules, origins)) throw new Error("生产素材 Bucket CORS 回读校验失败");
}

async function verifyLiveAccess(serverClient: TosClient, publicClient: TosClient, bucket: string) {
  const key = `__cors-doctor__/${crypto.randomUUID()}.txt`;
  const payload = new TextEncoder().encode(`xbeacon-browser-access:${crypto.randomUUID()}\n`);
  const expectedHash = createHash("sha256").update(payload).digest("hex");
  let uploaded = false;
  let result: { putStatus: number; getStatus: number; rangeStatus: number; bytes: number } | undefined;
  let verificationError: unknown;
  try {
    const uploadUrl = publicClient.getPreSignedUrl({ bucket, key, method: "PUT", expires: 300 });
    const upload = await fetch(uploadUrl, {
      method: "PUT",
      headers: { Origin: APP_ORIGIN, "Content-Type": "text/plain; charset=utf-8" },
      body: Buffer.from(payload),
    });
    if (!upload.ok) throw new Error(`生产 TOS 签名 PUT 失败（HTTP ${upload.status}）`);
    if (upload.headers.get("access-control-allow-origin") !== APP_ORIGIN)
      throw new Error("生产 TOS PUT 响应缺少 app Origin");
    uploaded = true;

    const head = await serverClient.headObject({ bucket, key });
    if (Number(head.data["content-length"]) !== payload.byteLength) throw new Error("生产 TOS HEAD 大小校验失败");
    if (!String(head.data["content-type"] ?? "").startsWith("text/plain"))
      throw new Error("生产 TOS HEAD Content-Type 校验失败");

    const readUrl = publicClient.getPreSignedUrl({ bucket, key, method: "GET", expires: 300 });
    const range = await fetch(readUrl, { headers: { Origin: APP_ORIGIN, Range: "bytes=0-15" } });
    const rangeBytes = new Uint8Array(await range.arrayBuffer());
    if (range.status !== 206 || rangeBytes.byteLength !== 16) throw new Error("生产 TOS Range 读取校验失败");
    if (range.headers.get("access-control-allow-origin") !== APP_ORIGIN)
      throw new Error("生产 TOS Range 响应缺少 app Origin");
    if (range.headers.get("content-range") !== `bytes 0-15/${payload.byteLength}`)
      throw new Error("生产 TOS Content-Range 校验失败");

    const read = await fetch(readUrl, { headers: { Origin: APP_ORIGIN } });
    const readBytes = new Uint8Array(await read.arrayBuffer());
    const actualHash = createHash("sha256").update(readBytes).digest("hex");
    if (!read.ok || actualHash !== expectedHash) throw new Error("生产 TOS 完整下载内容校验失败");
    if (read.headers.get("access-control-allow-origin") !== APP_ORIGIN)
      throw new Error("生产 TOS GET 响应缺少 app Origin");

    result = { putStatus: upload.status, getStatus: read.status, rangeStatus: range.status, bytes: payload.byteLength };
  } catch (error) {
    verificationError = error;
  }
  let cleanupError: unknown;
  try {
    if (uploaded) await serverClient.deleteObject({ bucket, key });
    if (await serverClient.doesObjectExist({ bucket, key })) cleanupError = new Error("生产 TOS 临时校验对象清理失败");
  } catch (error) {
    cleanupError = error;
  }
  if (verificationError) throw verificationError;
  if (cleanupError) throw cleanupError;
  if (!result) throw new Error("生产 TOS 实际访问验证没有结果");
  return result;
}

async function main() {
  if (!process.argv.includes("--production")) throw new Error("必须显式传入 --production");
  const { bucket, serverEndpoint, publicEndpoint } = assertProductionConfiguration();
  const origins = parseCorsOrigins(required("TOS_CORS_ORIGINS"));
  if (!origins.includes(APP_ORIGIN)) throw new Error(`TOS_CORS_ORIGINS 缺少 ${APP_ORIGIN}`);
  const serverClient = createClient(serverEndpoint);
  const publicClient = createClient(publicEndpoint);
  await serverClient.putBucketAcl({ bucket, acl: ACLType.ACLPrivate });
  await configureCors(serverClient, bucket, origins);
  const live = process.argv.includes("--verify-live")
    ? await verifyLiveAccess(serverClient, publicClient, bucket)
    : undefined;
  console.log(
    `生产素材 Bucket 浏览器访问已就绪：bucket=${bucket} origins=${origins.length}${live ? ` put=${live.putStatus} get=${live.getStatus} range=${live.rangeStatus} bytes=${live.bytes}` : ""}`,
  );
}

if (import.meta.main)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
