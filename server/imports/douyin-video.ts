import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Allowed douyin share URL pattern.
 * Only accepts HTTPS v.douyin.com short links.
 */
const DOUYIN_SHARE_PATTERN = /^https:\/\/v\.douyin\.com\/[a-zA-Z0-9_-]+\/?(\?.*)?$/;

/** Allowed douyin video CDN hostnames — exact hostname match only. */
const ALLOWED_VIDEO_HOSTNAMES = new Set([
  "v26-web.douyinvod.com",
  "v3-web.douyinvod.com",
  "sf3-sign.douyinstatic.com",
]);

export interface DouyinDownloadResult {
  filePath: string;
  /** The temp directory created by this download — caller must clean up after consuming the file. */
  tempDir: string;
  mimeType: string;
  byteSize: number;
}

export class DouyinDownloadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly reason:
      | "invalid_url"
      | "video_not_found"
      | "access_restricted"
      | "download_failed"
      | "config_error",
  ) {
    super(message);
    this.name = "DouyinDownloadError";
  }
}

/** Validate that the input looks like an allowed douyin share URL. */
export function validateDouyinUrl(input: string): string {
  const trimmed = input.trim();
  if (!DOUYIN_SHARE_PATTERN.test(trimmed)) {
    throw new DouyinDownloadError(
      "仅支持 HTTPS v.douyin.com 公开分享链接",
      false,
      "invalid_url",
    );
  }
  return trimmed;
}

/** Strict hostname check — rejects any URL where hostname is not exactly in the allowlist. */
function isAllowedVideoHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return ALLOWED_VIDEO_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
}

/**
 * Download a publicly accessible douyin video via Playwright.
 *
 * SECURITY: This function runs ONLY in the Worker process.
 * Temporary CDN URLs, cookies, and browser sessions are never
 * returned to the caller or persisted to the database.
 */
export async function downloadDouyinVideo(
  shareUrl: string,
  timeoutMs = 30_000,
): Promise<DouyinDownloadResult> {
  const validatedUrl = validateDouyinUrl(shareUrl);

  let playwright: typeof import("playwright") | undefined;
  const tempDir = mkdtempSync(join(tmpdir(), "dy-import-"));
  let returned = false;

  try {
    playwright = await import("playwright");
  } catch {
    rmSync(tempDir, { recursive: true, force: true });
    throw new DouyinDownloadError(
      "Playwright 未安装，无法下载抖音视频",
      true,
      "config_error",
    );
  }

  let browser: import("playwright").Browser | undefined;
  let context: import("playwright").BrowserContext | undefined;
  let page: import("playwright").Page | undefined;

  try {
    browser = await playwright.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    context = await browser.newContext({
      acceptDownloads: true,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    });
    page = await context.newPage();

    // Capture the first allowed video response URL using strict hostname check
    let capturedVideoUrl: string | null = null;
    let monitorSwitch = true;

    page.on("response", (response) => {
      if (!monitorSwitch) return;
      if (isAllowedVideoHost(response.url())) {
        capturedVideoUrl = response.request().url();
        monitorSwitch = false;
      }
    });

    // Navigate to the share page — domcontentloaded is sufficient;
    // networkidle can hang indefinitely due to analytics/beacon requests.
    await page.goto(validatedUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    // Wait for the page to settle and video requests to fire
    await page.waitForTimeout(3_000);

    // Check for "video not found" indicator
    try {
      const text = await page
        .locator(".IODnWoHY")
        .textContent({ timeout: 2_000 });
      if (text === "你要观看的视频不存在") {
        throw new DouyinDownloadError(
          "视频不存在或已被删除",
          false,
          "video_not_found",
        );
      }
    } catch (err) {
      if (err instanceof DouyinDownloadError) throw err;
    }

    // Reload to trigger media requests, then poll for capture
    if (!capturedVideoUrl) {
      await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForTimeout(1_000);
    }

    // Poll for video capture (up to 10 seconds)
    const pollStart = Date.now();
    while (!capturedVideoUrl && Date.now() - pollStart < 10_000) {
      await page.waitForTimeout(500);
    }

    if (!capturedVideoUrl) {
      throw new DouyinDownloadError(
        "未能捕获视频地址，该视频可能需要登录或存在访问限制",
        false,
        "access_restricted",
      );
    }

    // Fetch + blob download with Content-Type validation
    const filePath = join(tempDir, "video.mp4");

    const downloadPromise = page.waitForEvent("download", {
      timeout: timeoutMs,
    });

    await page.evaluate(
      ({ url, headers: hdrs }) => {
        return fetch(url, { headers: hdrs })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const ct = res.headers.get("content-type") ?? "";
            if (
              !ct.startsWith("video/") &&
              !ct.startsWith("application/octet-stream")
            ) {
              throw new Error(`Unexpected Content-Type: ${ct}`);
            }
            return res.blob();
          })
          .then((blob) => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "video.mp4";
            a.click();
          });
      },
      {
        url: capturedVideoUrl,
        headers: {
          Referer: capturedVideoUrl,
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
        },
      },
    );

    const download = await downloadPromise;
    await download.saveAs(filePath);

    const file = Bun.file(filePath);
    const byteSize = await file.size;
    if (byteSize === 0) {
      throw new DouyinDownloadError(
        "下载的视频文件为空",
        false,
        "download_failed",
      );
    }

    returned = true;
    return { filePath, tempDir, mimeType: "video/mp4", byteSize };
  } catch (err) {
    if (err instanceof DouyinDownloadError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new DouyinDownloadError(
      `抖音视频下载失败: ${message}`,
      true,
      "download_failed",
    );
  } finally {
    // Always clean up browser resources
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});

    // Clean up tempDir on any exception path where we didn't return to caller.
    // If `returned` is true, the caller owns tempDir and must call cleanupDownloadDir().
    if (!returned) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

/**
 * Remove a temp directory created by downloadDouyinVideo.
 * Only removes directories whose absolute path starts with the system tmpdir
 * and that contain the module-specific prefix "dy-import-".
 * Call after the downloaded file has been consumed (uploaded/copied).
 */
export function cleanupDownloadDir(tempDir: string): void {
  const systemTmp = tmpdir();
  const resolved = join(tempDir); // normalizes path
  // Guard: only delete directories under the system temp dir that contain our prefix
  if (
    !resolved.startsWith(systemTmp) ||
    !resolved.includes("dy-import-")
  ) {
    return;
  }
  // Additional guard: the path must be a direct subpath of tmpdir
  const relative = resolved.slice(systemTmp.length).replace(/^\/+/, "");
  if (relative.includes("..") || relative.length === 0) return;

  rmSync(resolved, { recursive: true, force: true });
}
