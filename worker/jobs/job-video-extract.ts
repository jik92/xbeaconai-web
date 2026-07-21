import { lookup } from "node:dns/promises";
import { mkdtemp, open, readdir, rm } from "node:fs/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { probeMedia } from "../../server/media/ffmpeg";
import { ossutils } from "../../server/storage/ossutils";
import type { JobResult, StageProvenance } from "../../server/types";
import type { WorkerJobHandler } from "./types";

const privateIpv4 = (address: string) => {
  const octets = address.split(".").map(Number);
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    octets[0] === 0 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
};

export async function validatePublicVideoUrl(value: string) {
  const url = new URL(value);
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("仅支持 HTTP 或 HTTPS 视频地址");
  if (url.username || url.password) throw new Error("视频地址不能包含账号凭据");
  const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some(
      ({ address }) =>
        privateIpv4(address) ||
        address === "::1" ||
        address.startsWith("fc") ||
        address.startsWith("fd") ||
        address.startsWith("fe80:"),
    )
  )
    throw new Error("视频地址不能指向本机或内网");
  return url;
}

const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;

async function openPublicUrl(value: string, method: "HEAD" | "GET") {
  let url = await validatePublicVideoUrl(value);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(url, { method, redirect: "manual", signal: AbortSignal.timeout(30_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("视频地址返回了无效重定向");
      url = await validatePublicVideoUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`视频地址访问失败（HTTP ${response.status}）`);
    return response;
  }
  throw new Error("视频地址重定向次数过多");
}

async function downloadDirectVideo(url: string, outputPath: string, onProgress: (progress: number) => void) {
  const head = await openPublicUrl(url, "HEAD");
  const contentType = head.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!contentType.startsWith("video/") && !/\.(mp4|mov|m4v|webm|mkv)(?:$|[?#])/i.test(url)) return false;
  const contentLength = Number(head.headers.get("content-length") ?? 0);
  if (contentLength > MAX_DOWNLOAD_BYTES) throw new Error("视频超过 2GB 下载限制");
  const response = await openPublicUrl(url, "GET");
  const responseLength = Number(response.headers.get("content-length") ?? 0);
  if (responseLength > MAX_DOWNLOAD_BYTES) throw new Error("视频超过 2GB 下载限制");
  if (!response.body) throw new Error("视频地址没有返回文件内容");
  const file = await open(outputPath, "w");
  const reader = response.body.getReader();
  let downloaded = 0;
  let lastReported = -1;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      downloaded += value.byteLength;
      if (downloaded > MAX_DOWNLOAD_BYTES) throw new Error("视频超过 2GB 下载限制");
      await file.write(value);
      if (responseLength > 0) {
        const percent = Math.min(100, Math.floor((downloaded / responseLength) * 100));
        if (percent >= lastReported + 2) {
          lastReported = percent;
          onProgress(percent);
        }
      }
    }
  } finally {
    reader.releaseLock();
    await file.close();
  }
  return true;
}

async function inspectVideo(path: string) {
  if (Bun.which("ffprobe")) {
    const media = await probeMedia(path);
    const video = media.streams.find((stream) => stream.codec_type === "video");
    if (!video) throw new Error("下载内容不包含视频流");
    return { video, durationSec: Number(media.format.duration ?? 0) || undefined };
  }
  const header = new Uint8Array(await Bun.file(path).slice(0, 32).arrayBuffer());
  const signature = new TextDecoder().decode(header);
  if (!signature.includes("ftyp")) throw new Error("未安装 ffprobe，且下载内容无法确认为 MP4 视频");
  return { video: undefined, durationSec: undefined };
}

export const videoExtractJob: WorkerJobHandler = {
  name: "video-extract",
  supports: (job) => job.moduleId === "video-extract",
  async execute(job, context) {
    const { accounts } = context;
    if (!accounts) throw new Error("素材所有权服务不可用");
    if (!ossutils.configured) throw new Error("TOS_NOT_CONFIGURED: 视频提取必须保存到私有 TOS");
    const folder = accounts.getAssetFolder(job.ownerUserId, job.values.outputFolderId ?? "");
    if (!folder) throw new Error("保存文件夹不存在或不属于当前账号");
    const sourceUrl = (await validatePublicVideoUrl(job.values.url ?? "")).toString();
    const tempDir = await mkdtemp(resolve(tmpdir(), "yaozuo-video-extract-"));
    const plan: StageProvenance[] = [
      {
        id: `${job.id}:download`,
        capability: "video-download",
        executionMode: "local",
        implementation: "direct-http-or-yt-dlp",
        startedAt: new Date().toISOString(),
      },
    ];
    try {
      context.change(job.id, {
        status: "processing",
        stage: "正在解析并下载视频",
        progress: 5,
        executionPlan: plan,
        provenance: plan,
        overallExecutionMode: "local",
      });
      const directPath = resolve(tempDir, "source.mp4");
      const direct = await downloadDirectVideo(sourceUrl, directPath, (percent) =>
        context.change(job.id, {
          stage: `正在下载视频 ${percent}%`,
          progress: Math.round(5 + percent * 0.55),
        }),
      );
      if (!direct) {
        if (!Bun.which("yt-dlp")) throw new Error("该地址不是视频直链；解析分享页需要安装 yt-dlp");
        const process = Bun.spawn(
          [
            "yt-dlp",
            "--no-playlist",
            "--no-part",
            "--max-filesize",
            "2G",
            "--socket-timeout",
            "30",
            "--restrict-filenames",
            "--merge-output-format",
            "mp4",
            "-o",
            resolve(tempDir, "source.%(ext)s"),
            sourceUrl,
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
        const exitCode = await process.exited;
        if (exitCode !== 0) {
          const detail = (await new Response(process.stderr).text()).trim().slice(-800);
          throw new Error(`视频下载失败${detail ? `：${detail}` : ""}`);
        }
      }
      const outputName = (await readdir(tempDir)).find((name) => name.startsWith("source."));
      if (!outputName) throw new Error("视频下载没有生成有效文件");
      const outputPath = resolve(tempDir, outputName);
      context.change(job.id, { stage: "正在校验视频", progress: 65 });
      const { video, durationSec } = await inspectVideo(outputPath);
      const file = Bun.file(outputPath);
      const safeName = `${basename(outputName, `.${outputName.split(".").at(-1)}`).replace(/[^\p{L}\p{N}._-]+/gu, "-") || "提取视频"}.mp4`;
      const assetId = crypto.randomUUID();
      const storageKey = `${folder.storagePrefix}generated/${job.id}/${safeName}`;
      context.change(job.id, { stage: "正在保存到素材库", progress: 78 });
      await ossutils.putLibraryFile({
        filePath: outputPath,
        key: storageKey,
        mimeType: "video/mp4",
        sizeBytes: file.size,
        onProgress: (percent) => {
          const uploadPercent = Math.max(0, Math.min(100, Math.round(percent * 100)));
          context.change(job.id, {
            stage: `正在保存到素材库 ${uploadPercent}%`,
            progress: Math.min(99, Math.round(78 + percent * 21)),
          });
        },
      });
      accounts.createAsset({
        id: assetId,
        ownerUserId: job.ownerUserId,
        storageKey,
        originalName: safeName,
        mimeType: "video/mp4",
        byteSize: file.size,
        width: video?.width,
        height: video?.height,
        durationSec,
        kind: "media",
        displayName: safeName.replace(/\.mp4$/, ""),
        description: `由视频提取任务 ${job.id} 创建`,
        folderId: folder.id,
        createdAt: new Date().toISOString(),
      });
      plan[0]!.completedAt = new Date().toISOString();
      const artifacts: JobResult["artifacts"] = [
        {
          id: assetId,
          name: safeName,
          mimeType: "video/mp4",
          url: `/api/assets/${assetId}/content`,
          executionMode: "local",
          lineage: plan,
        },
      ];
      context.change(job.id, {
        status: "succeeded",
        stage: "已保存到素材库",
        progress: 100,
        provenance: plan,
        result: {
          kind: "video-extract",
          title: job.title,
          summary: `视频已保存到“${folder.name}”。`,
          artifacts,
          data: { values: job.values, generatedAt: new Date().toISOString(), mock: false },
        },
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  },
};
