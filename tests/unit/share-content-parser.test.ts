import { describe, expect, test } from "bun:test";
import { platformAdapters, ShareContentParser } from "../../server/imports/share-content";

const parser = new ShareContentParser(platformAdapters);

describe("ShareContentParser", () => {
  describe("douyin", () => {
    test("extracts standard douyin URL", () => {
      const result = parser.parse("https://v.douyin.com/i5Jp6KMR/");
      expect(result.length).toBeGreaterThanOrEqual(1);
      const douyin = result.filter((c) => c.platformId === "douyin");
      expect(douyin.length).toBeGreaterThanOrEqual(1);
      expect(douyin[0].raw).toContain("v.douyin.com");
      expect(douyin[0].confidence).toBe("high");
    });

    test("extracts douyin URL from mixed text", () => {
      const text = "看看这个视频 https://v.douyin.com/abc123/ 很有意思";
      const result = parser.parse(text);
      const douyin = result.filter((c) => c.platformId === "douyin");
      expect(douyin.length).toBeGreaterThanOrEqual(1);
      expect(douyin[0].raw).toContain("v.douyin.com/abc123");
    });

    test("extracts douyin share code from copy-paste text", () => {
      // Example from user: "4.66 i@C.uf :4pm kcN:/ 复制此链接，打开抖音搜索"
      const text = "4.66 i@C.uf :4pm kcN:/ 复制此链接，打开抖音搜索";
      const result = parser.parse(text);
      const douyin = result.filter((c) => c.platformId === "douyin");
      expect(douyin.length).toBeGreaterThanOrEqual(1);
      // Should contain the normalized URL
      expect(douyin.some((c) => c.raw.includes("4pmkcN"))).toBe(true);
    });

    test("share code candidates have medium confidence", () => {
      const text = "4.66 i@C.uf :4pm kcN:/ 复制此链接";
      const result = parser.parse(text);
      const douyin = result.filter((c) => c.platformId === "douyin");
      const codeCandidates = douyin.filter((c) => c.confidence === "medium");
      expect(codeCandidates.length).toBeGreaterThanOrEqual(1);
    });

    test("returns empty for unrelated text", () => {
      const result = parser.parse("这是一段普通的文本，不包含任何链接");
      expect(result.length).toBe(0);
    });

    test("returns empty for empty input", () => {
      expect(parser.parse("").length).toBe(0);
      expect(parser.parse("   ").length).toBe(0);
    });
  });

  describe("kuaishou", () => {
    test("recognizes kuaishou URL", () => {
      const result = parser.parse("https://v.kuaishou.com/abc123");
      const ks = result.filter((c) => c.platformId === "kuaishou");
      expect(ks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("youtube", () => {
    test("recognizes youtube URL", () => {
      const result = parser.parse("https://www.youtube.com/watch?v=abc123def45");
      const yt = result.filter((c) => c.platformId === "youtube");
      expect(yt.length).toBeGreaterThanOrEqual(1);
    });

    test("recognizes youtu.be short URL", () => {
      const result = parser.parse("https://youtu.be/abc123def45");
      const yt = result.filter((c) => c.platformId === "youtube");
      expect(yt.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("x", () => {
    test("recognizes x.com URL", () => {
      const result = parser.parse("https://x.com/user/status/123456");
      const x = result.filter((c) => c.platformId === "x");
      expect(x.length).toBeGreaterThanOrEqual(1);
    });

    test("recognizes twitter.com URL", () => {
      const result = parser.parse("https://twitter.com/user/status/123456");
      const x = result.filter((c) => c.platformId === "x");
      expect(x.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("multi-platform", () => {
    test("extracts multiple candidates from mixed text", () => {
      const text =
        "抖音: https://v.douyin.com/abc/ 快手: https://v.kuaishou.com/def YouTube: https://youtu.be/ghi";
      const result = parser.parse(text);
      const platforms = new Set(result.map((c) => c.platformId));
      expect(platforms.has("douyin")).toBe(true);
      expect(platforms.has("kuaishou")).toBe(true);
      expect(platforms.has("youtube")).toBe(true);
    });

    test("sorts by confidence", () => {
      const text = "https://v.douyin.com/abc/ :4pm kcN:/ test";
      const result = parser.parse(text);
      for (let i = 1; i < result.length; i++) {
        const order = { high: 0, medium: 1, low: 2 };
        expect(
          order[result[i - 1].confidence] <= order[result[i].confidence],
        ).toBe(true);
      }
    });
  });

  describe("adapterFor", () => {
    test("returns adapter for known platform", () => {
      expect(parser.adapterFor("douyin")?.platformId).toBe("douyin");
      expect(parser.adapterFor("kuaishou")?.platformId).toBe("kuaishou");
    });

    test("returns undefined for unknown platform", () => {
      expect(parser.adapterFor("unknown-platform")).toBeUndefined();
    });
  });

  describe("downloadableAdapters", () => {
    test("douyin supports download", () => {
      const downloadable = parser.downloadableAdapters;
      const douyin = downloadable.find((a) => a.platformId === "douyin");
      expect(douyin).toBeDefined();
      expect(douyin?.supportsDownload).toBe(true);
    });

    test("kuaishou, youtube, x do not support download", () => {
      for (const id of ["kuaishou", "youtube", "x"]) {
        const adapter = parser.adapterFor(id);
        expect(adapter?.supportsDownload).toBe(false);
      }
    });
  });
});
