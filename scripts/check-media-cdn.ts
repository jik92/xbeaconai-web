import { resolveCname } from "node:dns/promises";
import TosClient from "@volcengine/tos-sdk";

function encodedObjectKey(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

export function buildMediaCdnCheckUrls(input: { domain: string; imageKey: string; videoKey: string }) {
  const imageOriginal = `https://${input.domain}/${encodedObjectKey(input.imageKey)}`;
  return {
    imageOriginal,
    imageThumbnail: `${imageOriginal}?x-tos-process=style/thumbnail`,
    imagePreview: `${imageOriginal}?x-tos-process=style/preview`,
    videoOriginal: `https://${input.domain}/${encodedObjectKey(input.videoKey)}`,
  };
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 未配置`);
  return value;
}

async function expectStatus(response: Response, expected: number, label: string) {
  if (response.status !== expected) throw new Error(`${label} 状态错误：${response.status}，期望 ${expected}`);
  return response;
}

async function probeImageDimensions(bytes: Uint8Array, maxEdge: number, label: string) {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  const process = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      "pipe:0",
    ],
    { stdin: new Blob([copy.buffer]), stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`${label}尺寸检查失败：${stderr.trim() || `ffprobe=${exitCode}`}`);
  const parsed = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }> };
  const dimensions = parsed.streams?.[0];
  if (!dimensions?.width || !dimensions.height) throw new Error(`${label}没有可识别的宽高`);
  if (Math.max(dimensions.width, dimensions.height) > maxEdge)
    throw new Error(`${label}长边超过 ${maxEdge}：${dimensions.width}x${dimensions.height}`);
  return dimensions;
}

async function findExistingVideoKey() {
  const region = required("TOS_REGION");
  const bucket = required("TOS_BUCKET");
  const client = new TosClient({
    accessKeyId: required("TOS_ACCESS_KEY_ID"),
    accessKeySecret: required("TOS_SECRET_ACCESS_KEY"),
    region,
    endpoint: process.env.TOS_SERVER_ENDPOINT?.trim() || `tos-${region}.ivolces.com`,
    secure: true,
    requestTimeout: 60_000,
    connectionTimeout: 15_000,
    maxRetryCount: 2,
  });
  let continuationToken: string | undefined;
  do {
    const page = await client.listObjectsType2({
      bucket,
      continuationToken,
      maxKeys: 1_000,
      listOnlyOnce: true,
    });
    const match = page.data.Contents?.find((item) => item.Size > 16 && /\.(?:mp4|mov|webm|m4v)$/i.test(item.Key));
    if (match) return match.Key;
    continuationToken = page.data.IsTruncated ? page.data.NextContinuationToken : undefined;
  } while (continuationToken);
  throw new Error("MEDIA_CDN_VIDEO_KEY 未配置，且 Bucket 中未找到可用于 Range 检查的视频对象");
}

async function expectWebp(response: Response, label: string) {
  const contentType = response.headers.get("content-type");
  if (!contentType?.toLowerCase().includes("image/webp"))
    throw new Error(`${label}格式错误：${contentType ?? "missing"}`);
}

async function main() {
  const domain = process.env.MEDIA_CDN_DOMAIN?.trim() || "files.xbeaconai.com";
  const videoKey = process.env.MEDIA_CDN_VIDEO_KEY?.trim() || (await findExistingVideoKey());
  const urls = buildMediaCdnCheckUrls({
    domain,
    imageKey: process.env.MEDIA_CDN_IMAGE_KEY?.trim() || "system/portraits/1.png",
    videoKey,
  });
  const cnames = await resolveCname(domain);
  if (!cnames.length) throw new Error(`${domain} 没有 CNAME 解析`);
  const allowedHeaders = { Referer: "https://app.xbeaconai.com/" };
  const imageOriginal = await expectStatus(await fetch(urls.imageOriginal, { headers: allowedHeaders }), 200, "原图");
  const imageThumbnail = await expectStatus(
    await fetch(urls.imageThumbnail, { headers: allowedHeaders }),
    200,
    "图片缩略图",
  );
  const imagePreview = await expectStatus(await fetch(urls.imagePreview, { headers: allowedHeaders }), 200, "图片预览");
  await expectWebp(imageThumbnail, "图片缩略图");
  await expectWebp(imagePreview, "图片预览");
  const thumbnailDimensions = await probeImageDimensions(
    new Uint8Array(await imageThumbnail.arrayBuffer()),
    320,
    "图片缩略图",
  );
  const previewDimensions = await probeImageDimensions(
    new Uint8Array(await imagePreview.arrayBuffer()),
    1280,
    "图片预览",
  );
  const videoRange = await expectStatus(
    await fetch(urls.videoOriginal, { headers: { ...allowedHeaders, Range: "bytes=0-15" } }),
    206,
    "视频 Range",
  );
  if (!videoRange.headers.get("content-range")?.startsWith("bytes 0-15/"))
    throw new Error(`视频 Content-Range 错误：${videoRange.headers.get("content-range") ?? "missing"}`);
  const emptyReferer = await fetch(urls.imageOriginal, { redirect: "manual" });
  if (emptyReferer.status !== 403) throw new Error(`空 Referer 未被拒绝：${emptyReferer.status}`);
  if (new Set([imageOriginal.url, imageThumbnail.url, imagePreview.url]).size !== 3)
    throw new Error("原图、缩略图与预览图缓存键未区分");
  console.log(
    JSON.stringify(
      {
        domain,
        cname: cnames,
        image: {
          format: imagePreview.headers.get("content-type"),
          thumbnail: thumbnailDimensions,
          preview: previewDimensions,
        },
        videoKey,
        videoRange: videoRange.headers.get("content-range"),
        emptyReferer: emptyReferer.status,
      },
      null,
      2,
    ),
  );
}

if (import.meta.main)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
