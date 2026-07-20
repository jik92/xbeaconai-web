import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium } from "playwright";
import type { Browser, BrowserContext } from "playwright";
import {
  DouyinImportError,
  resolveDouyinVideoWithBrowser,
  type DetailFetcher,
  type VideoFetcher,
} from "../../server/imports/douyin-video";

const TARGET_AWEME_ID = "7642343910555143430";
const AD_AWEME_ID = "9999999999999999999";
const TARGET_CDN = "https://v26-web.douyinvod.com/target.mp4";
const AD_CDN = "https://v26-web.douyinvod.com/ad.mp4";
const MP4 = new Uint8Array(new Array(1024).fill(0).map((_, i) => i % 256));

function detailJson(awemeId: string, urls: string[]) {
  return JSON.stringify({
    aweme_detail: { aweme_id: awemeId, video: { play_addr: { url_list: urls }, duration: 30000 } },
  });
}

function makeDetailFetcher(onlyForAwemeId: string | null): DetailFetcher {
  return async (_ctx: BrowserContext, awemeId: string) => {
    if (onlyForAwemeId !== null && awemeId !== onlyForAwemeId) {
      throw new DouyinImportError("DETAIL_API_FAILED", "获取作品详情失败", 502);
    }
    const urls = awemeId === TARGET_AWEME_ID ? [TARGET_CDN] : [AD_CDN];
    return {
      url: `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${awemeId}`,
      body: detailJson(awemeId, urls),
    };
  };
}

function makeVideoFetcher(expectedUrl: string | null, httpStatus = 200): VideoFetcher {
  return async (_ctx: BrowserContext, cdnUrl: string, _referer: string) => {
    if (expectedUrl !== null && cdnUrl !== expectedUrl) {
      throw new DouyinImportError("VIDEO_DOWNLOAD_FAILED", "下载视频失败", 502);
    }
    return {
      bytes: MP4,
      status: httpStatus,
      headers: { "content-type": "video/mp4", "content-length": String(MP4.length) },
      sourceUrl: cdnUrl,
    };
  };
}

describe("Resolver active fetch with injectable fetchers", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  test("ad fetchers are never called when target awemeId is used", async () => {
    const context = await browser.newContext();
    await context.route("**/*", (route) => {
      const u = route.request().url();
      if (u === "https://v.douyin.com/1/")
        return route.fulfill({ status: 302, headers: { location: `https://www.douyin.com/video/${TARGET_AWEME_ID}` } });
      if (u === `https://www.douyin.com/video/${TARGET_AWEME_ID}`)
        return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body></body></html>" });
      return route.continue().catch(() => route.abort());
    });

    const detailFetcher: DetailFetcher = async (_ctx, awemeId) => {
      expect(awemeId).toBe(TARGET_AWEME_ID);
      return { url: `u/${awemeId}`, body: detailJson(TARGET_AWEME_ID, [TARGET_CDN]) };
    };
    const videoFetcher: VideoFetcher = async (_ctx, cdnUrl, _ref) => {
      expect(cdnUrl).toBe(TARGET_CDN);
      return { bytes: MP4, status: 200, headers: { "content-type": "video/mp4", "content-length": String(MP4.length) }, sourceUrl: cdnUrl };
    };

    const result = await resolveDouyinVideoWithBrowser(browser, "https://v.douyin.com/1/", {
      context,
      fetchDetail: detailFetcher,
      fetchVideo: videoFetcher,
    });

    expect(result.sourceUrl).toBe(TARGET_CDN);
    expect(result.mimeType).toBe("video/mp4");
    await context.close();
  });

  test("mismatched awemeId in detail response throws", async () => {
    const context = await browser.newContext();
    await context.route("**/*", (route) => {
      const u = route.request().url();
      if (u === "https://v.douyin.com/2/")
        return route.fulfill({ status: 302, headers: { location: `https://www.douyin.com/video/${TARGET_AWEME_ID}` } });
      if (u === `https://www.douyin.com/video/${TARGET_AWEME_ID}`)
        return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body></body></html>" });
      return route.continue().catch(() => route.abort());
    });

    const detailFetcher: DetailFetcher = async (_ctx, awemeId) => {
      return { url: `u/${awemeId}`, body: detailJson(AD_AWEME_ID, [AD_CDN]) };
    };

    await expect(
      resolveDouyinVideoWithBrowser(browser, "https://v.douyin.com/2/", {
        context,
        fetchDetail: detailFetcher,
        fetchVideo: makeVideoFetcher(TARGET_CDN),
      }),
    ).rejects.toThrow("作品详情中的作品 ID 与目标不匹配");
    await context.close();
  });

  test("no matching CDN url in url_list throws", async () => {
    const context = await browser.newContext();
    await context.route("**/*", (route) => {
      const u = route.request().url();
      if (u === "https://v.douyin.com/3/")
        return route.fulfill({ status: 302, headers: { location: `https://www.douyin.com/video/${TARGET_AWEME_ID}` } });
      if (u === `https://www.douyin.com/video/${TARGET_AWEME_ID}`)
        return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body></body></html>" });
      return route.continue().catch(() => route.abort());
    });

    const detailFetcher: DetailFetcher = async (_ctx, awemeId) => {
      return { url: `u/${awemeId}`, body: detailJson(TARGET_AWEME_ID, []) };
    };

    await expect(
      resolveDouyinVideoWithBrowser(browser, "https://v.douyin.com/3/", {
        context,
        fetchDetail: detailFetcher,
        fetchVideo: makeVideoFetcher(TARGET_CDN),
      }),
    ).rejects.toThrow("无法从作品详情获取目标视频地址");
    await context.close();
  });

  test("detail API failure throws", async () => {
    const context = await browser.newContext();
    await context.route("**/*", (route) => {
      const u = route.request().url();
      if (u === "https://v.douyin.com/4/")
        return route.fulfill({ status: 302, headers: { location: `https://www.douyin.com/video/${TARGET_AWEME_ID}` } });
      if (u === `https://www.douyin.com/video/${TARGET_AWEME_ID}`)
        return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body></body></html>" });
      return route.continue().catch(() => route.abort());
    });

    await expect(
      resolveDouyinVideoWithBrowser(browser, "https://v.douyin.com/4/", {
        context,
        fetchDetail: makeDetailFetcher("0000000000000000000"),
        fetchVideo: makeVideoFetcher(TARGET_CDN),
      }),
    ).rejects.toThrow(DouyinImportError);
    await context.close();
  });

  test("detail response without aweme_detail.aweme_id is rejected", async () => {
    const context = await browser.newContext();
    await context.route("**/*", (route) => {
      const u = route.request().url();
      if (u === "https://v.douyin.com/5/")
        return route.fulfill({ status: 302, headers: { location: `https://www.douyin.com/video/${TARGET_AWEME_ID}` } });
      if (u === `https://www.douyin.com/video/${TARGET_AWEME_ID}`)
        return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body></body></html>" });
      return route.continue().catch(() => route.abort());
    });

    const detailFetcher: DetailFetcher = async (_ctx, awemeId) => {
      const body = JSON.stringify({
        aweme_detail: { video: { play_addr: { url_list: [TARGET_CDN] } } },
      });
      return { url: `u/${awemeId}`, body };
    };

    await expect(
      resolveDouyinVideoWithBrowser(browser, "https://v.douyin.com/5/", {
        context,
        fetchDetail: detailFetcher,
        fetchVideo: makeVideoFetcher(TARGET_CDN),
      }),
    ).rejects.toThrow("作品详情中的作品 ID 与目标不匹配");
    await context.close();
  });

  test("video fetcher 206 status is rejected by validateFullResponse", async () => {
    const context = await browser.newContext();
    await context.route("**/*", (route) => {
      const u = route.request().url();
      if (u === "https://v.douyin.com/6/")
        return route.fulfill({ status: 302, headers: { location: `https://www.douyin.com/video/${TARGET_AWEME_ID}` } });
      if (u === `https://www.douyin.com/video/${TARGET_AWEME_ID}`)
        return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body></body></html>" });
      return route.continue().catch(() => route.abort());
    });

    await expect(
      resolveDouyinVideoWithBrowser(browser, "https://v.douyin.com/6/", {
        context,
        fetchDetail: makeDetailFetcher(TARGET_AWEME_ID),
        fetchVideo: makeVideoFetcher(TARGET_CDN, 206),
      }),
    ).rejects.toThrow("平台返回了部分视频内容（206）");
    await context.close();
  });
});
