import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  directMediaSource,
  downloadAuthenticated,
  downloadDirectUrl,
  isPublicMediaUrl,
  mediaAccessUrlForContent,
} from "../../web/api/api-client";

const window = new Window();
let clicked: { href: string; download: string } | undefined;
let originalClick: typeof window.HTMLAnchorElement.prototype.click;
let originalFetch: typeof globalThis.fetch;

beforeAll(() => {
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    HTMLAnchorElement: window.HTMLAnchorElement,
  });
  originalClick = window.HTMLAnchorElement.prototype.click;
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  clicked = undefined;
  window.HTMLAnchorElement.prototype.click = originalClick;
  globalThis.fetch = originalFetch;
  window.localStorage.clear();
  document.body.replaceChildren();
});

describe("public media download", () => {
  test("accepts only the exact approved CDN origin", () => {
    expect(isPublicMediaUrl("https://files.xbeaconai.com/users/demo/image.jpg")).toBe(true);
    expect(isPublicMediaUrl("https://files.xbeaconai.com:444/users/demo/image.jpg")).toBe(false);
    expect(isPublicMediaUrl("https://files.xbeaconai.com.evil.example/users/demo/image.jpg")).toBe(false);
    expect(directMediaSource("https://files.xbeaconai.com/users/demo/image.jpg")).toBe(
      "https://files.xbeaconai.com/users/demo/image.jpg",
    );
    expect(directMediaSource("/api/assets/00000000-0000-4000-8000-000000000000/content")).toBeUndefined();
    expect(mediaAccessUrlForContent("/api/assets/00000000-0000-4000-8000-000000000000/content")).toBe(
      "/api/assets/00000000-0000-4000-8000-000000000000/access",
    );
    expect(mediaAccessUrlForContent("/api/artifacts/00000000-0000-4000-8000-000000000001")).toBe(
      "/api/artifacts/00000000-0000-4000-8000-000000000001/access",
    );
  });

  test("clicks the approved CDN original URL without fetching or creating a Blob", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      throw new Error("public CDN downloads must not be fetched into a Blob");
    }) as unknown as typeof fetch;
    window.HTMLAnchorElement.prototype.click = function click() {
      clicked = { href: this.href, download: this.download };
    };

    downloadDirectUrl("https://files.xbeaconai.com/users/demo/%E5%95%86%E5%93%81.jpg", "商品.jpg");

    expect(fetchCalls).toBe(0);
    expect(clicked).toEqual({
      href: "https://files.xbeaconai.com/users/demo/%E5%95%86%E5%93%81.jpg",
      download: "商品.jpg",
    });
  });

  test("rejects non-CDN media downloads without fetching the file body", () => {
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      throw new Error("untrusted media must not be fetched");
    }) as unknown as typeof fetch;

    expect(() => downloadDirectUrl("/api/assets/00000000-0000-4000-8000-000000000000/content", "private.jpg")).toThrow(
      "媒体文件未使用受信任的 CDN 地址",
    );
    expect(fetchCalls).toBe(0);
  });

  test("resolves a protected asset identifier and downloads the CDN original", async () => {
    window.localStorage.setItem("yaozuo:auth-token:v1", "download-media-test-token");
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          url: "https://files.xbeaconai.com/users/demo/image.jpg?x-tos-process=style/preview",
          originalUrl: "https://files.xbeaconai.com/users/demo/image.jpg",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;
    window.HTMLAnchorElement.prototype.click = function click() {
      clicked = { href: this.href, download: this.download };
    };

    await downloadAuthenticated("/api/assets/00000000-0000-4000-8000-000000000001/content", "image.jpg");

    expect(clicked).toEqual({
      href: "https://files.xbeaconai.com/users/demo/image.jpg",
      download: "image.jpg",
    });
  });
});
