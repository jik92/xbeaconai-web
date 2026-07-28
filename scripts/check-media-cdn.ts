import { resolveCname } from "node:dns/promises";

function encodedObjectKey(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

export function buildMediaCdnCheckUrls(input: { domain: string; imageKey: string; videoKey: string }) {
  const imageOriginal = `https://${input.domain}/${encodedObjectKey(input.imageKey)}`;
  return {
    imageOriginal,
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

async function probeImageDimensions(bytes: Uint8Array) {
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
  if (exitCode !== 0) throw new Error(`预览图尺寸检查失败：${stderr.trim() || `ffprobe=${exitCode}`}`);
  const parsed = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }> };
  const dimensions = parsed.streams?.[0];
  if (!dimensions?.width || !dimensions.height) throw new Error("预览图没有可识别的宽高");
  if (Math.max(dimensions.width, dimensions.height) > 1280)
    throw new Error(`预览图长边超过 1280：${dimensions.width}x${dimensions.height}`);
  return dimensions;
}

async function main() {
  const domain = process.env.MEDIA_CDN_DOMAIN?.trim() || "files.xbeaconai.com";
  const urls = buildMediaCdnCheckUrls({
    domain,
    imageKey: required("MEDIA_CDN_IMAGE_KEY"),
    videoKey: required("MEDIA_CDN_VIDEO_KEY"),
  });
  const cnames = await resolveCname(domain);
  if (!cnames.length) throw new Error(`${domain} 没有 CNAME 解析`);
  const allowedHeaders = { Referer: "https://app.xbeaconai.com/" };
  const imageOriginal = await expectStatus(await fetch(urls.imageOriginal, { headers: allowedHeaders }), 200, "原图");
  const imagePreview = await expectStatus(await fetch(urls.imagePreview, { headers: allowedHeaders }), 200, "图片预览");
  if (!imagePreview.headers.get("content-type")?.toLowerCase().includes("image/webp"))
    throw new Error(`图片预览格式错误：${imagePreview.headers.get("content-type") ?? "missing"}`);
  const dimensions = await probeImageDimensions(new Uint8Array(await imagePreview.arrayBuffer()));
  const videoRange = await expectStatus(
    await fetch(urls.videoOriginal, { headers: { ...allowedHeaders, Range: "bytes=0-15" } }),
    206,
    "视频 Range",
  );
  if (!videoRange.headers.get("content-range")?.startsWith("bytes 0-15/"))
    throw new Error(`视频 Content-Range 错误：${videoRange.headers.get("content-range") ?? "missing"}`);
  const emptyReferer = await fetch(urls.imageOriginal, { redirect: "manual" });
  if (emptyReferer.status !== 403) throw new Error(`空 Referer 未被拒绝：${emptyReferer.status}`);
  if (imageOriginal.url === imagePreview.url) throw new Error("原图与预览图缓存键未区分");
  console.log(
    JSON.stringify(
      {
        domain,
        cname: cnames,
        image: { format: imagePreview.headers.get("content-type"), ...dimensions },
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
