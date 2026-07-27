import { describe, expect, test } from "bun:test";
import { cacheControlForKey, contentTypeForKey } from "../../scripts/deploy-web-cdn";

describe("web CDN release metadata", () => {
  test("keeps HTML revalidated and hashed assets immutable", () => {
    expect(cacheControlForKey("index.html")).toBe("no-cache, no-store, max-age=0, must-revalidate");
    expect(cacheControlForKey("_releases/release-1/index.html")).toBe("no-cache, no-store, max-age=0, must-revalidate");
    expect(cacheControlForKey("assets/app-a1b2c3.js")).toBe("public, max-age=31536000, immutable");
    expect(cacheControlForKey("favicon.ico")).toBe("public, max-age=3600, must-revalidate");
  });

  test("publishes browser-safe content types", () => {
    expect(contentTypeForKey("assets/app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeForKey("assets/app.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeForKey("index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeForKey("assets/font.woff2")).toBe("font/woff2");
  });
});
