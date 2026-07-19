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

export function parseDouyinShareUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new DouyinImportError("INVALID_DOUYIN_URL", "请输入有效的抖音分享链接", 400);
  }
  if (url.protocol !== "https:" || !isShareHost(url.hostname))
    throw new DouyinImportError("UNSUPPORTED_DOUYIN_URL", "仅支持抖音 HTTPS 分享链接", 400);
  return url;
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

export async function resolveDouyinVideo(shareUrl: string): Promise<ResolvedDouyinVideo> {
  const source = parseDouyinShareUrl(shareUrl);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.route("**/*", (route) => {
      try {
        const url = new URL(route.request().url());
        if (url.protocol === "https:" && isAllowedNetworkHost(url.hostname)) return route.continue();
      } catch {
        /* Abort malformed URLs below. */
      }
      return route.abort();
    });
    const page = await context.newPage();
    const videoResponse = page.waitForResponse(
      (response) => isCandidateVideo(response.url(), response.headers()["content-type"] ?? ""),
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
    const declaredLength = Number(response.headers()["content-length"] ?? "");
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 1)
      throw new DouyinImportError("VIDEO_SIZE_UNAVAILABLE", "无法确认视频大小，无法安全导入", 422);
    if (declaredLength > MAX_VIDEO_BYTES)
      throw new DouyinImportError("VIDEO_TOO_LARGE", "视频超过 500MB，无法导入", 413);
    const bytes = await response.body();
    if (!bytes.byteLength) throw new DouyinImportError("EMPTY_VIDEO", "未获取到有效视频内容", 422);
    if (bytes.byteLength > MAX_VIDEO_BYTES)
      throw new DouyinImportError("VIDEO_TOO_LARGE", "视频超过 500MB，无法导入", 413);
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
