import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const SHARE_HOSTS = new Set(["v.douyin.com", "www.douyin.com", "www.iesdouyin.com"]);

export class DouyinImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 413 | 415 | 422 | 502 | 503,
  ) {
    super(message);
  }
}

export interface ResolvedDouyinVideo {
  bytes: Uint8Array;
  mimeType: "video/mp4";
  sourceUrl: string;
}

export interface ImportPersistenceDeps {
  dataDir: string;
  ossutils?: {
    configured: boolean;
    putLibraryFile: (input: { filePath: string; key: string; mimeType: string; sizeBytes: number }) => Promise<void>;
  };
  accounts: {
    createAsset: (asset: {
      id: string;
      ownerUserId: string;
      storageKey: string;
      originalName: string;
      mimeType: string;
      byteSize: number;
      kind: "media" | "product" | "portrait" | "voice";
      displayName: string;
      description?: string;
      folderId?: string;
      createdAt: string;
    }) => void;
  };
}

export interface PersistedImportAsset {
  id: string;
  name: string;
  originalName: string;
  mimeType: string;
  size: number;
  kind: "media";
  description: string;
  folderId: string;
  url: string;
  createdAt: string;
}

function isShareHost(hostname: string) {
  return SHARE_HOSTS.has(hostname.toLowerCase());
}

function isVideoCdnHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host.endsWith(".douyinvod.com") || host.endsWith(".douyinstatic.com");
}

function isAllowedNetworkHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host.endsWith(".douyin.com") || isVideoCdnHost(host);
}

function findDouyinUrls(text: string): string[] {
  const urlPattern = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of text.matchAll(urlPattern)) {
    try {
      const u = new URL(match[0]);
      if (u.protocol === "https:" && isShareHost(u.hostname) && !seen.has(u.href)) {
        seen.add(u.href);
        result.push(u.href);
      }
    } catch {
      /* skip malformed tokens */
    }
  }
  return result;
}

export function parseDouyinShareUrl(value: string): URL {
  const trimmed = value.trim();

  // Fast path: input is already a well-formed supported URL
  try {
    const direct = new URL(trimmed);
    if (direct.protocol === "https:" && isShareHost(direct.hostname)) return direct;
  } catch {
    /* not a parseable URL — try share-text extraction below */
  }

  // Extract candidate douyin HTTPS URLs from pasted share text
  const candidates = findDouyinUrls(trimmed);
  if (candidates.length === 0) {
    // Determine the best error message
    try {
      new URL(trimmed);
      // Parsable but wrong protocol or host
    } catch {
      throw new DouyinImportError("INVALID_DOUYIN_URL", "请输入有效的抖音分享链接", 400);
    }
    throw new DouyinImportError("UNSUPPORTED_DOUYIN_URL", "仅支持抖音 HTTPS 分享链接", 400);
  }
  if (candidates.length > 1)
    throw new DouyinImportError("MULTIPLE_DOUYIN_URLS", "分享文本包含多个抖音链接，请只保留一个", 400);
  return new URL(candidates[0]);
}

export function assertImportAuthorization(authorized: boolean) {
  if (!authorized)
    throw new DouyinImportError("IMPORT_AUTHORIZATION_REQUIRED", "请确认你拥有该视频的下载和使用授权", 422);
}

function isCandidateVideo(url: string, contentType: string) {
  try {
    return isVideoCdnHost(new URL(url).hostname) && contentType.toLowerCase().startsWith("video/mp4");
  } catch {
    return false;
  }
}

export function validateFullResponse(details: {
  status: number;
  headers: Record<string, string>;
  byteLength: number;
}): void {
  if (details.status === 206)
    throw new DouyinImportError("VIDEO_PARTIAL", "平台返回了部分视频内容（206），无法完整导入", 422);
  if (details.headers["content-range"])
    throw new DouyinImportError("VIDEO_PARTIAL", "平台返回了分段视频内容（Content-Range），无法完整导入", 422);
  if (!details.headers["content-type"]?.toLowerCase().startsWith("video/mp4"))
    throw new DouyinImportError("UNSUPPORTED_MEDIA_TYPE", "仅支持导入 MP4 视频", 415);
  const declaredLength = Number(details.headers["content-length"] ?? "");
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 1)
    throw new DouyinImportError("VIDEO_SIZE_UNAVAILABLE", "无法确认视频大小，无法安全导入", 422);
  if (declaredLength > MAX_VIDEO_BYTES) throw new DouyinImportError("VIDEO_TOO_LARGE", "视频超过 500MB，无法导入", 413);
  if (!details.byteLength) throw new DouyinImportError("EMPTY_VIDEO", "未获取到有效视频内容", 422);
  if (details.byteLength > MAX_VIDEO_BYTES)
    throw new DouyinImportError("VIDEO_TOO_LARGE", "视频超过 500MB，无法导入", 413);
  if (details.byteLength !== declaredLength)
    throw new DouyinImportError(
      "VIDEO_SIZE_MISMATCH",
      `视频实际大小（${details.byteLength} 字节）与声明的大小（${declaredLength} 字节）不一致，文件可能不完整`,
      422,
    );
}

export async function resolveDouyinVideo(shareUrl: string): Promise<ResolvedDouyinVideo> {
  const source = parseDouyinShareUrl(shareUrl);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.route("**/*", (route) => {
      try {
        const url = new URL(route.request().url());
        if (url.protocol === "https:" && isAllowedNetworkHost(url.hostname)) {
          if (isVideoCdnHost(url.hostname))
            return route.continue({
              headers: (() => {
                const h: Record<string, string> = {};
                for (const [k, v] of Object.entries(route.request().headers())) {
                  if (k.toLowerCase() !== "range") h[k] = v;
                }
                return h;
              })(),
            });
          return route.continue();
        }
      } catch {
        /* Abort malformed URLs below. */
      }
      return route.abort();
    });
    const page = await context.newPage();
    const videoResponse = page.waitForResponse(
      (response) =>
        response.status() === 200 && isCandidateVideo(response.url(), response.headers()["content-type"] ?? ""),
      { timeout: 20_000 },
    );
    await page.goto(source.href, { waitUntil: "domcontentloaded", timeout: 20_000 });
    const finalUrl = new URL(page.url());
    if (!isShareHost(finalUrl.hostname))
      throw new DouyinImportError("UNSUPPORTED_DOUYIN_REDIRECT", "分享链接跳转到了不受支持的地址", 400);
    await page.evaluate(
      () =>
        void document
          .querySelector("video")
          ?.play()
          .catch(() => undefined),
    );
    const response = await videoResponse;
    const bytes = await response.body();
    validateFullResponse({
      status: response.status(),
      headers: response.headers(),
      byteLength: bytes.byteLength,
    });
    return { bytes, mimeType: "video/mp4", sourceUrl: response.url() };
  } catch (error) {
    if (error instanceof DouyinImportError) throw error;
    const message = error instanceof Error ? error.message : "未知错误";
    if (/executable doesn't exist|Please run the following command/i.test(message))
      throw new DouyinImportError(
        "PLAYWRIGHT_BROWSER_UNAVAILABLE",
        "导入组件未安装 Chromium，请执行 bun x playwright install chromium",
        503,
      );
    if (/Timeout/i.test(message))
      throw new DouyinImportError("DOUYIN_VIDEO_TIMEOUT", "未能在限定时间内获取视频，请检查链接或稍后重试", 502);
    throw new DouyinImportError("DOUYIN_VIDEO_IMPORT_FAILED", "抖音视频导入失败，请检查链接是否可公开访问", 502);
  } finally {
    await browser?.close();
  }
}

export async function persistImportVideo(
  video: ResolvedDouyinVideo,
  userId: string,
  folder: { id: string; storagePrefix: string },
  displayNameInput: string | undefined,
  deps: ImportPersistenceDeps,
): Promise<PersistedImportAsset> {
  const id = crypto.randomUUID();
  const storageKey = `${folder.storagePrefix}${id}.mp4`;
  const displayName = displayNameInput?.trim().slice(0, 80) || "抖音导入视频";
  const originalName = `${displayName}.mp4`;
  const createdAt = new Date().toISOString();
  const localPath = resolve(deps.dataDir, "uploads", storageKey);
  mkdirSync(dirname(localPath), { recursive: true, mode: 0o700 });
  await Bun.write(localPath, video.bytes);
  if (deps.ossutils?.configured)
    await deps.ossutils.putLibraryFile({
      filePath: localPath,
      key: storageKey,
      mimeType: video.mimeType,
      sizeBytes: video.bytes.byteLength,
    });
  deps.accounts.createAsset({
    id,
    ownerUserId: userId,
    storageKey,
    originalName,
    mimeType: video.mimeType,
    byteSize: video.bytes.byteLength,
    kind: "media",
    displayName,
    description: "从抖音链接导入",
    folderId: folder.id,
    createdAt,
  });
  return {
    id,
    name: displayName,
    originalName,
    mimeType: video.mimeType,
    size: video.bytes.byteLength,
    kind: "media" as const,
    description: "从抖音链接导入",
    folderId: folder.id,
    url: `/api/assets/${id}/content`,
    createdAt,
  };
}
