import { describe, expect, test } from "bun:test";
import { classifyInput } from "../../web/features/video-extract/route-input";
import type { ShareCandidate } from "../../web/api/api-client";

function candidate(overrides: Partial<ShareCandidate> = {}): ShareCandidate {
  return {
    raw: "https://v.douyin.com/abc123/",
    platformId: "douyin",
    confidence: "high",
    label: "抖音分享链接",
    ...overrides,
  };
}

describe("classifyInput", () => {
  // ── Empty / whitespace ────────────────────────────────────────────

  test("empty string returns empty", () => {
    expect(classifyInput([], "")).toEqual({ kind: "empty" });
  });

  test("whitespace-only returns empty", () => {
    expect(classifyInput([], "   ")).toEqual({ kind: "empty" });
  });

  test("empty with candidates returns empty (shouldn't happen but safe)", () => {
    expect(classifyInput([candidate()], "")).toEqual({ kind: "empty" });
  });

  // ── Direct video URL (no candidates) ──────────────────────────────

  test("no candidates + http URL → video-extract", () => {
    const result = classifyInput([], "http://example.com/video.mp4");
    expect(result).toEqual({ kind: "video-extract", url: "http://example.com/video.mp4" });
  });

  test("no candidates + https URL → video-extract", () => {
    const result = classifyInput([], "https://example.com/video.mp4");
    expect(result).toEqual({ kind: "video-extract", url: "https://example.com/video.mp4" });
  });

  test("no candidates + URL with whitespace → trims and routes to video-extract", () => {
    const result = classifyInput([], "  https://example.com/video.mp4  ");
    expect(result).toEqual({ kind: "video-extract", url: "https://example.com/video.mp4" });
  });

  test("no candidates + URL with query and path → video-extract", () => {
    const result = classifyInput([], "https://cdn.example.com/path/to/video.mp4?token=abc&expires=123");
    expect(result).toEqual({
      kind: "video-extract",
      url: "https://cdn.example.com/path/to/video.mp4?token=abc&expires=123",
    });
  });

  // ── Invalid input (no candidates, not a valid http/https URL) ──────

  test("no candidates + plain text → invalid", () => {
    const result = classifyInput([], "some random text");
    expect(result.kind).toBe("invalid");
  });

  test("no candidates + sentence in Chinese → invalid", () => {
    const result = classifyInput([], "这是一段普通的文本");
    expect(result.kind).toBe("invalid");
  });

  test("no candidates + ftp URL → invalid", () => {
    const result = classifyInput([], "ftp://files.example.com/video.mp4");
    expect(result.kind).toBe("invalid");
  });

  test("no candidates + javascript protocol → invalid", () => {
    const result = classifyInput([], "javascript:alert(1)");
    expect(result.kind).toBe("invalid");
  });

  test("no candidates + data URI → invalid", () => {
    const result = classifyInput([], "data:text/plain,hello");
    expect(result.kind).toBe("invalid");
  });

  test("no candidates + file URL → invalid", () => {
    const result = classifyInput([], "file:///etc/passwd");
    expect(result.kind).toBe("invalid");
  });

  test("no candidates + invalid URL format → invalid", () => {
    const result = classifyInput([], "not-a-url:::bad");
    expect(result.kind).toBe("invalid");
  });

  test("no candidates + URL without scheme → invalid", () => {
    const result = classifyInput([], "example.com/video.mp4");
    expect(result.kind).toBe("invalid");
  });

  test("no candidates + only numbers → invalid", () => {
    const result = classifyInput([], "12345");
    expect(result.kind).toBe("invalid");
  });

  // ── Single share candidate → auto-route ───────────────────────────

  test("single douyin candidate → share-import", () => {
    const c = candidate({ platformId: "douyin", raw: "https://v.douyin.com/abc/" });
    const result = classifyInput([c], "https://v.douyin.com/abc/");
    expect(result).toEqual({ kind: "share-import", candidate: c });
  });

  test("single kuaishou candidate → share-import", () => {
    const c = candidate({ platformId: "kuaishou", raw: "https://v.kuaishou.com/def" });
    const result = classifyInput([c], "https://v.kuaishou.com/def");
    expect(result).toEqual({ kind: "share-import", candidate: c });
  });

  test("single youtube candidate → share-import", () => {
    const c = candidate({ platformId: "youtube", raw: "https://youtube.com/watch?v=abc" });
    const result = classifyInput([c], "check this https://youtube.com/watch?v=abc");
    expect(result).toEqual({ kind: "share-import", candidate: c });
  });

  test("single x/twitter candidate → share-import", () => {
    const c = candidate({ platformId: "x", raw: "https://x.com/user/status/123" });
    const result = classifyInput([c], "https://x.com/user/status/123");
    expect(result).toEqual({ kind: "share-import", candidate: c });
  });

  test("single candidate from share code text → share-import", () => {
    const c = candidate({
      platformId: "douyin",
      raw: "4pmkcN",
      confidence: "medium",
      label: "抖音分享码",
    });
    const result = classifyInput([c], "4.66 i@C.uf :4pm kcN:/ 复制此链接");
    expect(result).toEqual({ kind: "share-import", candidate: c });
  });

  // ── Multiple candidates → user must confirm ───────────────────────

  test("two candidates (douyin + kuaishou) → multi-candidate", () => {
    const douyin = candidate({ platformId: "douyin", raw: "https://v.douyin.com/abc/" });
    const kuaishou = candidate({ platformId: "kuaishou", raw: "https://v.kuaishou.com/def" });
    const result = classifyInput([douyin, kuaishou], "抖音 https://v.douyin.com/abc/ 快手 https://v.kuaishou.com/def");
    expect(result).toEqual({ kind: "multi-candidate", candidates: [douyin, kuaishou] });
  });

  test("three candidates from mixed text → multi-candidate", () => {
    const douyin = candidate({ platformId: "douyin", raw: "https://v.douyin.com/a/" });
    const youtube = candidate({ platformId: "youtube", raw: "https://youtu.be/b" });
    const x = candidate({ platformId: "x", raw: "https://x.com/c/status/1" });
    const result = classifyInput([douyin, youtube, x], "multiple links");
    expect(result).toEqual({ kind: "multi-candidate", candidates: [douyin, youtube, x] });
  });

  test("two candidates, one high confidence one medium → still multi-candidate", () => {
    const high = candidate({ platformId: "douyin", confidence: "high", raw: "https://v.douyin.com/a/" });
    const medium = candidate({ platformId: "douyin", confidence: "medium", raw: "code123" });
    const result = classifyInput([high, medium], "text with URL and code");
    // Must NOT auto-select the high-confidence one — user must confirm
    expect(result.kind).toBe("multi-candidate");
  });
});
