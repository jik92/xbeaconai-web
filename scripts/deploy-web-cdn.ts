import { Buffer } from "node:buffer";
import { readdir } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import TosClient, { ACLType, StorageClassType } from "@volcengine/tos-sdk";
import { callVolcOpenApi } from "../server/providers/volc-openapi";

const LONG_CACHE = "public, max-age=31536000, immutable";
const SHORT_CACHE = "public, max-age=3600, must-revalidate";
const HTML_CACHE = "no-cache, no-store, max-age=0, must-revalidate";

const contentTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".otf": "font/otf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

export function contentTypeForKey(key: string) {
  return contentTypes[extname(key).toLowerCase()] ?? "application/octet-stream";
}

export function cacheControlForKey(key: string) {
  if (key.endsWith(".html")) return HTML_CACHE;
  if (key.startsWith("assets/")) return LONG_CACHE;
  return SHORT_CACHE;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 未配置`);
  return value;
}

function webBucketName() {
  return process.env.TOS_WEB_BUCKET?.trim() || "xbeaconai-web-prod";
}

function tosClient() {
  return new TosClient({
    accessKeyId: required("TOS_ACCESS_KEY_ID"),
    accessKeySecret: required("TOS_SECRET_ACCESS_KEY"),
    region: required("TOS_REGION"),
    endpoint: process.env.TOS_SERVER_ENDPOINT?.trim() || `tos-${required("TOS_REGION")}.volces.com`,
    secure: true,
    requestTimeout: 120_000,
    connectionTimeout: 15_000,
    maxRetryCount: 2,
  });
}

export async function ensureWebBucket(client = tosClient(), bucket = webBucketName()) {
  const exists = await client.doesBucketExist({ bucket });
  if (!exists)
    await client.createBucket({
      bucket,
      acl: ACLType.ACLPrivate,
      storageClass: StorageClassType.StorageClassStandard,
    });
  await client.putBucketAcl({ bucket, acl: ACLType.ACLPrivate });
  const info = await client.getBucketInfo({ bucket });
  if (info.data.Bucket.Location !== required("TOS_REGION"))
    throw new Error(`前端 Bucket 地域错误：${info.data.Bucket.Location}`);
  return info.data.Bucket;
}

async function releaseFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return releaseFiles(root, path);
      if (!entry.isFile()) return [];
      return [relative(root, path).split(sep).join("/")];
    }),
  );
  return nested.flat().sort();
}

async function gitRevision() {
  const process = Bun.spawn(["git", "rev-parse", "--short=12", "HEAD"], { stdout: "pipe", stderr: "pipe" });
  if ((await process.exited) !== 0) throw new Error("无法读取 Git revision");
  return (await new Response(process.stdout).text()).trim();
}

async function verifyObject(client: TosClient, bucket: string, key: string, size: number, contentType: string) {
  const head = await client.headObject({ bucket, key });
  if (Number(head.data["content-length"]) !== size) throw new Error(`${key} 上传大小校验失败`);
  if (String(head.data["content-type"] ?? "").toLowerCase() !== contentType.toLowerCase())
    throw new Error(`${key} Content-Type 校验失败`);
  if (String(head.data["cache-control"] ?? "") !== cacheControlForKey(key))
    throw new Error(`${key} Cache-Control 校验失败`);
}

async function putFile(client: TosClient, bucket: string, root: string, key: string) {
  const filePath = resolve(root, key);
  const file = Bun.file(filePath);
  const contentType = contentTypeForKey(key);
  await client.putObjectFromFile({
    bucket,
    key,
    filePath,
    contentLength: file.size,
    contentType,
    cacheControl: cacheControlForKey(key),
  });
  await verifyObject(client, bucket, key, file.size, contentType);
  return { key, size: file.size, contentType, cacheControl: cacheControlForKey(key) };
}

async function putBytes(client: TosClient, bucket: string, key: string, body: Uint8Array, contentType: string) {
  await client.putObject({
    bucket,
    key,
    body: Buffer.from(body),
    contentLength: body.byteLength,
    contentType,
    cacheControl: cacheControlForKey(key),
  });
  await verifyObject(client, bucket, key, body.byteLength, contentType);
}

async function refreshCdn(domain: string) {
  const accessKeyId = required("TOS_ACCESS_KEY_ID");
  const secretAccessKey = required("TOS_SECRET_ACCESS_KEY");
  return callVolcOpenApi<{ TaskID?: string; TaskId?: string }>(
    {
      accessKeyId,
      secretAccessKey,
      endpoint: "https://cdn.volcengineapi.com",
      region: "cn-north-1",
      service: "CDN",
      version: "2021-03-01",
    },
    "SubmitRefreshTask",
    {
      Type: "file",
      Urls: `https://${domain}/\nhttps://${domain}/index.html`,
    },
  );
}

async function rollback(client: TosClient, bucket: string, releaseId: string, domain?: string) {
  const sourceKey = `_releases/${releaseId}/index.html`;
  if (!(await client.doesObjectExist({ bucket, key: sourceKey }))) throw new Error(`发布版本不存在：${releaseId}`);
  await client.copyObject({
    bucket,
    key: "index.html",
    srcBucket: bucket,
    srcKey: sourceKey,
    metadataDirective: "REPLACE",
    contentType: contentTypeForKey("index.html"),
    cacheControl: cacheControlForKey("index.html"),
  });
  const head = await client.headObject({ bucket, key: "index.html" });
  if (!head.data["content-length"]) throw new Error("回滚入口文件校验失败");
  if (domain) await refreshCdn(domain);
  return releaseId;
}

async function main() {
  const root = resolve(process.env.WEB_DIST_DIR?.trim() || "dist");
  const bucket = webBucketName();
  const domain = process.env.CDN_DOMAIN?.trim() || "app.xbeaconai.com";
  const client = tosClient();
  await ensureWebBucket(client, bucket);

  const rollbackAt = process.argv.indexOf("--rollback");
  if (rollbackAt >= 0) {
    const releaseId = process.argv[rollbackAt + 1];
    if (!releaseId) throw new Error("--rollback 需要发布版本 ID");
    await rollback(client, bucket, releaseId, domain);
    console.log(`前端已回滚：release=${releaseId} url=https://${domain}/`);
    return;
  }

  if (process.argv.includes("--ensure-bucket-only")) {
    console.log(`前端 Bucket 已就绪：${bucket}`);
    return;
  }

  const keys = await releaseFiles(root);
  if (!keys.includes("index.html")) throw new Error(`${root}/index.html 不存在，请先执行生产构建`);
  const revision = await gitRevision();
  const releaseId = `${revision}-${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14)}`;
  const assets = keys.filter((key) => key !== "index.html");
  const uploaded = [];
  for (const key of assets) uploaded.push(await putFile(client, bucket, root, key));

  const indexBytes = new Uint8Array(await Bun.file(resolve(root, "index.html")).arrayBuffer());
  const releaseIndexKey = `_releases/${releaseId}/index.html`;
  await putBytes(client, bucket, releaseIndexKey, indexBytes, contentTypeForKey("index.html"));
  const manifest = new TextEncoder().encode(
    `${JSON.stringify({ releaseId, revision, createdAt: new Date().toISOString(), files: uploaded }, null, 2)}\n`,
  );
  await putBytes(client, bucket, `_releases/${releaseId}/manifest.json`, manifest, contentTypeForKey("manifest.json"));

  if (await client.doesObjectExist({ bucket, key: "index.html" })) {
    const backupKey = `_rollbacks/${new Date().toISOString().replace(/[-:.TZ]/g, "")}/index.html`;
    await client.copyObject({ bucket, key: backupKey, srcBucket: bucket, srcKey: "index.html" });
  }
  await putBytes(client, bucket, "index.html", indexBytes, contentTypeForKey("index.html"));
  if (!process.argv.includes("--skip-refresh")) await refreshCdn(domain);
  console.log(`前端发布完成：release=${releaseId} bucket=${bucket} url=https://${domain}/`);
}

if (import.meta.main)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
