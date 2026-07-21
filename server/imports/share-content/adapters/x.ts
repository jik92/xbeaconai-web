import type { ShareCandidate, SharePlatformAdapter } from "../types";

/** X (Twitter) URL patterns — recognition only, no download. */
const X_URL_RE = /https:\/\/(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/gi;

export const xAdapter: SharePlatformAdapter = {
  platformId: "x",
  displayName: "X (Twitter)",
  supportsDownload: false,

  extractCandidates(text: string): ShareCandidate[] {
    const candidates: ShareCandidate[] = [];
    X_URL_RE.lastIndex = 0;

    for (const match of text.matchAll(X_URL_RE)) {
      const url = match[0];
      candidates.push({
        raw: url,
        platformId: "x",
        confidence: "high",
        label: `X 链接: ${url.slice(0, 50)}…`,
      });
    }

    return candidates;
  },

  normalize(candidate: ShareCandidate): string | null {
    try {
      const url = new URL(candidate.raw);
      return url.hostname === "x.com" || url.hostname === "twitter.com" ? candidate.raw : null;
    } catch {
      return null;
    }
  },

  async download(): Promise<never> {
    throw new Error("X/Twitter 下载尚未实现 — 仅支持平台识别");
  },
};
