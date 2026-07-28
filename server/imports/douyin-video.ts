import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "../env";

/**
 * Allowed douyin share URL pattern.
 * Only accepts HTTPS v.douyin.com short links.
 */
const DOUYIN_SHARE_PATTERN = /^https:\/\/v\.douyin\.com\/[a-zA-Z0-9_-]+\/?(\?.*)?$/;

/** Allowed douyin video CDN hostnames — exact hostname match only. */
const ALLOWED_VIDEO_HOSTNAMES = new Set([
  "v26-web.douyinvod.com",
  "v3-web.douyinvod.com",
  "v11-weba.douyinvod.com",
  "sf3-sign.douyinstatic.com",
]);

// Observed on the Douyin login guidance overlay. Keep this isolated so later
// observed variants can be added without changing the download flow.
const LOGIN_GUIDANCE_CLOSE_SELECTOR = "div.YoNA2Hyj.qKr0RhiL";

export interface DouyinDownloadResult {
  filePath: string;
  /** The temp directory created by this download — caller must clean up after consuming the file. */
  tempDir: string;
  mimeType: string;
  byteSize: number;
}

export type DouyinDownloadProgressStage =
  | "link_validation_start"
  | "link_validated"
  | "temp_dir_created"
  | "playwright_loading"
  | "browser_start"
  | "browser_ready"
  | "page_open_start"
  | "page_open_complete"
  | "debug_pause_start"
  | "debug_pause_complete"
  | "login_guidance_wait"
  | "login_guidance_closed"
  | "login_guidance_absent"
  | "page_settled"
  | "playback_trigger_start"
  | "playback_triggered"
  | "playback_control_absent"
  | "video_existence_check"
  | "media_capture_start"
  | "media_capture_complete"
  | "file_download_start"
  | "file_download_complete"
  | "browser_cleanup";

export type DouyinDownloadProgress = (stage: DouyinDownloadProgressStage) => void;

function reportProgress(onProgress: DouyinDownloadProgress | undefined, stage: DouyinDownloadProgressStage) {
  try {
    onProgress?.(stage);
  } catch {
    // Observability must never interrupt a download.
  }
}

export class DouyinDownloadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly reason: "invalid_url" | "video_not_found" | "access_restricted" | "download_failed" | "config_error",
  ) {
    super(message);
    this.name = "DouyinDownloadError";
  }
}

/** Validate that the input looks like an allowed douyin share URL. */
export function validateDouyinUrl(input: string): string {
  const trimmed = input.trim();
  if (!DOUYIN_SHARE_PATTERN.test(trimmed)) {
    throw new DouyinDownloadError("仅支持 HTTPS v.douyin.com 公开分享链接", false, "invalid_url");
  }
  return trimmed;
}

/** Strict hostname check — rejects any URL where hostname is not exactly in the allowlist. */
export function isAllowedDouyinVideoHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return ALLOWED_VIDEO_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
}

/**
 * Closes the optional login guidance overlay when its observed close control
 * is present. A missing/changed overlay is not an error: public videos may
 * render without it, and actual login/CAPTCHA restrictions remain respected.
 */
async function dismissLoginGuidance(page: import("playwright").Page): Promise<boolean> {
  try {
    await page.locator(LOGIN_GUIDANCE_CLOSE_SELECTOR).first().click({ timeout: 3_000, force: true });
    return true;
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
  onProgress?: DouyinDownloadProgress,
): Promise<DouyinDownloadResult> {
  reportProgress(onProgress, "link_validation_start");
  const validatedUrl = validateDouyinUrl(shareUrl);
  reportProgress(onProgress, "link_validated");

  let playwright: typeof import("playwright") | undefined;
  const tempDir = mkdtempSync(join(tmpdir(), "dy-import-"));
  reportProgress(onProgress, "temp_dir_created");
  let returned = false;

  try {
    reportProgress(onProgress, "playwright_loading");
    playwright = await import("playwright");
  } catch {
    rmSync(tempDir, { recursive: true, force: true });
    throw new DouyinDownloadError("Playwright 未安装，无法下载抖音视频", true, "config_error");
  }

  let browser: import("playwright").Browser | undefined;
  let context: import("playwright").BrowserContext | undefined;
  let page: import("playwright").Page | undefined;

  try {
    reportProgress(onProgress, "browser_start");
    browser = await playwright.chromium.launch({
      headless: env.douyinBrowserHeadless,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      // Match the original Python downloader: avoid Playwright's default
      // automation marker. This does not bypass authentication or CAPTCHA.
      ignoreDefaultArgs: ["--enable-automation"],
    });
    reportProgress(onProgress, "browser_ready");
    context = await browser.newContext({
      acceptDownloads: true,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    });
    page = await context.newPage();
    await page.addInitScript(() => {
      // Small built-in equivalent for the original downloader's stealth
      // bootstrap. It only removes the obvious WebDriver marker; access
      // controls (login/CAPTCHA/private content) are still respected.
      Object.defineProperty(navigator, "webdriver", { configurable: true, get: () => undefined });
    });

    // Capture the first allowed video response URL using strict hostname check
    let capturedVideoUrl: string | null = null;
    let monitorSwitch = true;

    page.on("response", (response) => {
      if (!monitorSwitch) return;
      if (isAllowedDouyinVideoHost(response.url())) {
        capturedVideoUrl = response.request().url();
        monitorSwitch = false;
      }
    });

    // Navigate to the share page — domcontentloaded is sufficient;
    // networkidle can hang indefinitely due to analytics/beacon requests.
    reportProgress(onProgress, "page_open_start");
    await page.goto(validatedUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    reportProgress(onProgress, "page_open_complete");

    // Gives a local operator time to inspect the visible page or sign in.
    // The session is ephemeral and is discarded after this job finishes.
    if (!env.douyinBrowserHeadless && env.douyinBrowserDebugPauseMs > 0) {
      reportProgress(onProgress, "debug_pause_start");
      await page.waitForTimeout(env.douyinBrowserDebugPauseMs);
      reportProgress(onProgress, "debug_pause_complete");
    }

    // Public share pages may show a dismissible login guidance overlay. Close
    // it only after the page has had time to render it; missing controls are normal.
    reportProgress(onProgress, "login_guidance_wait");
    await page.waitForTimeout(env.douyinLoginGuidanceWaitMs);
    if (await dismissLoginGuidance(page)) reportProgress(onProgress, "login_guidance_closed");
    else reportProgress(onProgress, "login_guidance_absent");

    // Wait for the page to settle and video requests to fire
    await page.waitForTimeout(3_000);
    reportProgress(onProgress, "page_settled");

    // The Python prototype clicks this page control before checking the
    // unavailable-video message. On current Douyin pages it can also trigger
    // the first media request, so preserve that behavior when the control is present.
    reportProgress(onProgress, "playback_trigger_start");
    try {
      await page.locator(".wSyUzWHW").click({ timeout: 2_000 });
      reportProgress(onProgress, "playback_triggered");
    } catch {
      // The selector is absent on many valid pages; continue normally.
      reportProgress(onProgress, "playback_control_absent");
    }

    // Check for "video not found" indicator
    reportProgress(onProgress, "video_existence_check");
    try {
      const text = await page.locator(".IODnWoHY").textContent({ timeout: 2_000 });
      if (text === "你要观看的视频不存在") {
        throw new DouyinDownloadError("视频不存在或已被删除", false, "video_not_found");
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
    reportProgress(onProgress, "media_capture_start");
    const pollStart = Date.now();
    while (!capturedVideoUrl && Date.now() - pollStart < 10_000) {
      await page.waitForTimeout(500);
    }

    if (!capturedVideoUrl) {
      throw new DouyinDownloadError("未能捕获视频地址，该视频可能需要登录或存在访问限制", false, "access_restricted");
    }
    reportProgress(onProgress, "media_capture_complete");

    // Download through the browser context so its cookies are preserved, then write the bytes directly.
    const filePath = join(tempDir, "video.mp4");

    reportProgress(onProgress, "file_download_start");
    const response = await page.request.get(capturedVideoUrl, {
      timeout: timeoutMs,
      headers: {
        Referer: capturedVideoUrl,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
      },
    });
    if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
    const contentType = response.headers()["content-type"] ?? "";
    if (!contentType.startsWith("video/") && !contentType.startsWith("application/octet-stream")) {
      throw new Error(`Unexpected Content-Type: ${contentType}`);
    }
    await Bun.write(filePath, await response.body());

    const file = Bun.file(filePath);
    const byteSize = await file.size;
    if (byteSize === 0) {
      throw new DouyinDownloadError("下载的视频文件为空", false, "download_failed");
    }
    reportProgress(onProgress, "file_download_complete");

    returned = true;
    return { filePath, tempDir, mimeType: "video/mp4", byteSize };
  } catch (err) {
    if (err instanceof DouyinDownloadError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new DouyinDownloadError(`抖音视频下载失败: ${message}`, true, "download_failed");
  } finally {
    // Always clean up browser resources
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    reportProgress(onProgress, "browser_cleanup");

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
  if (!resolved.startsWith(systemTmp) || !resolved.includes("dy-import-")) {
    return;
  }
  // Additional guard: the path must be a direct subpath of tmpdir
  const relative = resolved.slice(systemTmp.length).replace(/^\/+/, "");
  if (relative.includes("..") || relative.length === 0) return;

  rmSync(resolved, { recursive: true, force: true });
}
