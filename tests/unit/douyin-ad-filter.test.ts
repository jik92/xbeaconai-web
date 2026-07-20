import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { DouyinImportError, resolveDouyinVideoWithBrowser } from "../../server/imports/douyin-video";

const TARGET_AWEME_ID = "7642343910555143430";
const AD_AWEME_ID = "9999999999999999999";
const TARGET_CDN = "https://v26-web.douyinvod.com/target-video.mp4";
const AD_CDN = "https://v26-web.douyinvod.com/ad-video.mp4";

const MP4 = new Uint8Array(
  Buffer.concat([
    Buffer.from(new Array(8).fill(0)),
    Buffer.from("ftypmp42", "ascii"),
    Buffer.from(new Array(1008).fill(0)),
  ]),
);

function detailUrl(awemeId: string) {
  return `https://www.douyin.com/aweme/v1/web/aweme/detail/?device_platform=webapp&aid=6383&aweme_id=${awemeId}`;
}

function detailBody(_awemeId: string, urls: string[]) {
  return JSON.stringify({ aweme_detail: { video: { play_addr: { url_list: urls }, duration: 30000 } } });
}

function html(_awemeId: string, opts: { adDetail?: boolean; targetDetail?: boolean; targetCdn?: boolean }) {
  const s: string[] = [];
  if (opts.adDetail) s.push(`fetch("${detailUrl(AD_AWEME_ID)}");`);
  if (opts.targetDetail) s.push(`fetch("${detailUrl(TARGET_AWEME_ID)}");`);
  if (opts.targetCdn)
    s.push(`setTimeout(()=>{var v=document.querySelector("video");if(v)v.src="${TARGET_CDN}";},300);`);
  return `<html><body><video src=""></video><script>${s.join("")}</script></body></html>`;
}

describe("Resolver ad-first rejection", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  test("ad detail arrives first, resolver returns target sourceUrl", async () => {
    const context = await browser.newContext();
    await context.route("**/*", (route) => {
      const u = route.request().url();
      if (u === "https://v.douyin.com/t1/")
        return route.fulfill({ status: 302, headers: { location: `https://www.douyin.com/video/${TARGET_AWEME_ID}` } });
      if (u === `https://www.douyin.com/video/${TARGET_AWEME_ID}`)
        return route.fulfill({
          status: 200,
          contentType: "text/html",
          body: html(TARGET_AWEME_ID, { adDetail: true, targetDetail: true, targetCdn: true }),
        });
      if (u.includes("/aweme/v1/web/aweme/detail/") && u.includes(`aweme_id=${TARGET_AWEME_ID}`))
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: detailBody(TARGET_AWEME_ID, [TARGET_CDN]),
        });
      if (u.includes("/aweme/v1/web/aweme/detail/") && u.includes(`aweme_id=${AD_AWEME_ID}`))
        return route.fulfill({ status: 200, contentType: "application/json", body: detailBody(AD_AWEME_ID, [AD_CDN]) });
      if (u === TARGET_CDN)
        return route.fulfill({
          status: 200,
          contentType: "video/mp4",
          headers: { "content-length": String(MP4.length) },
          body: Buffer.from(MP4),
        });
      if (u === AD_CDN)
        return route.fulfill({
          status: 200,
          contentType: "video/mp4",
          headers: { "content-length": String(MP4.length) },
          body: Buffer.from(MP4),
        });
      return route.continue().catch(() => route.abort());
    });

    const result = await resolveDouyinVideoWithBrowser(browser, "https://v.douyin.com/t1/", { context });
    expect(result.sourceUrl).toBe(TARGET_CDN);
    expect(result.sourceUrl).not.toBe(AD_CDN);
    expect(result.mimeType).toBe("video/mp4");
    expect(result.bytes.length).toBe(MP4.length);
    await context.close();
  });

  test("ad detail only, resolver throws", async () => {
    const context = await browser.newContext();
    await context.route("**/*", (route) => {
      const u = route.request().url();
      if (u === "https://v.douyin.com/t2/")
        return route.fulfill({ status: 302, headers: { location: `https://www.douyin.com/video/${TARGET_AWEME_ID}` } });
      if (u === `https://www.douyin.com/video/${TARGET_AWEME_ID}`)
        return route.fulfill({
          status: 200,
          contentType: "text/html",
          body: html(TARGET_AWEME_ID, { adDetail: true }),
        });
      if (u.includes("/aweme/v1/web/aweme/detail/") && u.includes(`aweme_id=${AD_AWEME_ID}`))
        return route.fulfill({ status: 200, contentType: "application/json", body: detailBody(AD_AWEME_ID, [AD_CDN]) });
      return route.continue().catch(() => route.abort());
    });

    await expect(resolveDouyinVideoWithBrowser(browser, "https://v.douyin.com/t2/", { context })).rejects.toThrow(
      "无法从作品详情获取目标视频地址",
    );
    await context.close();
  });

  test("target detail only, resolver succeeds", async () => {
    const context = await browser.newContext();
    await context.route("**/*", (route) => {
      const u = route.request().url();
      if (u === "https://v.douyin.com/t3/")
        return route.fulfill({ status: 302, headers: { location: `https://www.douyin.com/video/${TARGET_AWEME_ID}` } });
      if (u === `https://www.douyin.com/video/${TARGET_AWEME_ID}`)
        return route.fulfill({
          status: 200,
          contentType: "text/html",
          body: html(TARGET_AWEME_ID, { targetDetail: true, targetCdn: true }),
        });
      if (u.includes("/aweme/v1/web/aweme/detail/") && u.includes(`aweme_id=${TARGET_AWEME_ID}`))
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: detailBody(TARGET_AWEME_ID, [TARGET_CDN]),
        });
      if (u === TARGET_CDN)
        return route.fulfill({
          status: 200,
          contentType: "video/mp4",
          headers: { "content-length": String(MP4.length) },
          body: Buffer.from(MP4),
        });
      return route.continue().catch(() => route.abort());
    });

    const result = await resolveDouyinVideoWithBrowser(browser, "https://v.douyin.com/t3/", { context });
    expect(result.sourceUrl).toBe(TARGET_CDN);
    expect(result.mimeType).toBe("video/mp4");
    await context.close();
  });

  test("no detail at all, resolver throws", async () => {
    const context = await browser.newContext();
    await context.route("**/*", (route) => {
      if (route.request().url() === "https://v.douyin.com/t4/")
        return route.fulfill({ status: 200, contentType: "text/html", body: html(TARGET_AWEME_ID, {}) });
      return route.continue().catch(() => route.abort());
    });

    await expect(resolveDouyinVideoWithBrowser(browser, "https://v.douyin.com/t4/", { context })).rejects.toThrow(
      DouyinImportError,
    );
    await context.close();
  });
});
