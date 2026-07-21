import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanupDownloadDir,
  downloadDouyinVideo,
  DouyinDownloadError,
  isAllowedDouyinVideoHost,
  validateDouyinUrl,
} from "../../server/imports/douyin-video";

describe("douyin URL validation", () => {
  test("accepts valid v.douyin.com share URLs", () => {
    expect(validateDouyinUrl("https://v.douyin.com/i5Jp6KMR/")).toBe("https://v.douyin.com/i5Jp6KMR/");
    expect(validateDouyinUrl("https://v.douyin.com/abc123DEF_xy-9/")).toBe("https://v.douyin.com/abc123DEF_xy-9/");
    expect(validateDouyinUrl("https://v.douyin.com/abc/?extra=1")).toBe("https://v.douyin.com/abc/?extra=1");
  });

  test("rejects non-HTTPS URLs", () => {
    expect(() => validateDouyinUrl("http://v.douyin.com/abc/")).toThrow(DouyinDownloadError);
  });

  test("rejects non-douyin domains", () => {
    expect(() => validateDouyinUrl("https://www.douyin.com/video/123")).toThrow(DouyinDownloadError);
    expect(() => validateDouyinUrl("https://example.com/share/abc")).toThrow(DouyinDownloadError);
    expect(() => validateDouyinUrl("https://tiktok.com/@user/video/123")).toThrow(DouyinDownloadError);
  });

  test("rejects douyin CDN URLs masquerading as share links", () => {
    // v26-web.douyinvod.com is a CDN host, not a share URL
    expect(() => validateDouyinUrl("https://v26-web.douyinvod.com/video/123")).toThrow(DouyinDownloadError);
    expect(() => validateDouyinUrl("https://v3-web.douyinvod.com/video/abc")).toThrow(DouyinDownloadError);
    expect(() => validateDouyinUrl("https://sf3-sign.douyinstatic.com/path")).toThrow(DouyinDownloadError);
  });

  test("rejects empty or whitespace input", () => {
    expect(() => validateDouyinUrl("")).toThrow(DouyinDownloadError);
    expect(() => validateDouyinUrl("   ")).toThrow(DouyinDownloadError);
  });

  test("throws DouyinDownloadError with correct fields", () => {
    try {
      validateDouyinUrl("not-a-url");
    } catch (err) {
      expect(err).toBeInstanceOf(DouyinDownloadError);
      const de = err as DouyinDownloadError;
      expect(de.retryable).toBe(false);
      expect(de.reason).toBe("invalid_url");
    }
  });
});

describe("douyin video CDN host validation", () => {
  test("accepts explicitly allowed video CDN hosts", () => {
    expect(isAllowedDouyinVideoHost("https://v26-web.douyinvod.com/video.mp4")).toBe(true);
    expect(isAllowedDouyinVideoHost("https://v11-weba.douyinvod.com/video/tos/cn/example.mp4")).toBe(true);
  });

  test("rejects unapproved lookalike subdomains", () => {
    expect(isAllowedDouyinVideoHost("https://v11-weba.douyinvod.com.evil.example/video.mp4")).toBe(false);
    expect(isAllowedDouyinVideoHost("https://other.douyinvod.com/video.mp4")).toBe(false);
  });
});

describe("cleanupDownloadDir", () => {
  const created: string[] = [];
  afterEach(() => {
    for (const dir of created) {
      try {
        cleanupDownloadDir(dir);
      } catch {
        /* already cleaned */
      }
    }
  });

  test("removes a temp directory created under system tmpdir with dy-import- prefix", () => {
    const dir = mkdtempSync(join(tmpdir(), "dy-import-test-"));
    created.push(dir);
    writeFileSync(join(dir, "test.mp4"), "dummy");
    expect(existsSync(dir)).toBe(true);
    cleanupDownloadDir(dir);
    expect(existsSync(dir)).toBe(false);
  });

  test("does not remove directories outside system tmpdir", () => {
    const dir = mkdtempSync(join(tmpdir(), "safe-non-dy-dir-"));
    created.push(dir);
    writeFileSync(join(dir, "data.txt"), "safe");
    // Pass a path that looks like it's outside tmpdir
    cleanupDownloadDir("/etc/dy-import-malicious");
    expect(existsSync(dir)).toBe(true);
  });

  test("does not remove directories without dy-import- prefix", () => {
    const dir = mkdtempSync(join(tmpdir(), "other-prefix-"));
    created.push(dir);
    writeFileSync(join(dir, "data.txt"), "safe");
    cleanupDownloadDir(dir);
    // Should still exist — prefix doesn't match
    expect(existsSync(dir)).toBe(true);
  });

  test("does not follow path traversal outside tmpdir", () => {
    const dir = mkdtempSync(join(tmpdir(), "dy-import-test2-"));
    created.push(dir);
    writeFileSync(join(dir, "data.txt"), "safe");
    // Attempt path traversal
    cleanupDownloadDir(join(tmpdir(), "dy-import-", "..", "..", "etc", "passwd"));
    expect(existsSync(dir)).toBe(true);
  });
});

describe("downloadDouyinVideo failure cleanup", () => {
  test("cleans up temp directory on invalid URL without leaving artifacts", async () => {
    const before = readdirSync(tmpdir()).filter((d) => d.startsWith("dy-import-")).length;

    // URL validation happens before playwright import — should fail fast
    try {
      await downloadDouyinVideo("not-a-valid-url", 1_000);
    } catch (err) {
      expect(err).toBeInstanceOf(DouyinDownloadError);
      expect((err as DouyinDownloadError).reason).toBe("invalid_url");
    }

    const after = readdirSync(tmpdir()).filter((d) => d.startsWith("dy-import-")).length;
    expect(after).toBe(before);
  });

  test("cleans up temp directory when playwright browser fails", async () => {
    // This test verifies that even when playwright is installed but
    // the download ultimately fails, the temp dir is cleaned up.
    // Use a very short timeout so browser operations fail quickly.
    const before = readdirSync(tmpdir()).filter((d) => d.startsWith("dy-import-")).length;

    try {
      await downloadDouyinVideo("https://v.douyin.com/test123/", 500);
    } catch (err) {
      expect(err).toBeInstanceOf(DouyinDownloadError);
      // Either config_error (no playwright) or download_failed (timeout)
      const de = err as DouyinDownloadError;
      expect(["config_error", "download_failed"]).toContain(de.reason);
    }

    const after = readdirSync(tmpdir()).filter((d) => d.startsWith("dy-import-")).length;
    // Temp dir must be cleaned up regardless of failure reason
    expect(after).toBe(before);
  });
});
