import type { ShareCandidate, SharePlatformAdapter } from "../types";

/** Kuaishou share URL and share code patterns — recognition only, no download. */
const KUAISHOU_URL_RE = /https:\/\/(?:v\.kuaishou\.com|www\.kuaishou\.com\/short-video)\/[a-zA-Z0-9_-]+/gi;
const KUAISHOU_SHARE_CODE_RE = /kuaishou\.com\/s\/[a-zA-Z0-9_-]+/gi;

export const kuaishouAdapter: SharePlatformAdapter = {
  platformId: "kuaishou",
  displayName: "快手",
  supportsDownload: false,

  extractCandidates(text: string): ShareCandidate[] {
    const candidates: ShareCandidate[] = [];

    for (const re of [KUAISHOU_URL_RE, KUAISHOU_SHARE_CODE_RE]) {
      re.lastIndex = 0;
      for (const match of text.matchAll(re)) {
        const url = match[0];
        candidates.push({
          raw: url.startsWith("http") ? url : `https://${url}`,
          platformId: "kuaishou",
          confidence: "high",
          label: `快手链接: ${url.slice(0, 50)}…`,
        });
      }
    }

    return candidates;
  },

  normalize(candidate: ShareCandidate): string | null {
    try {
      const url = new URL(candidate.raw);
      return url.hostname.includes("kuaishou.com") ? candidate.raw : null;
    } catch {
      return null;
    }
  },

  async download(): Promise<never> {
    throw new Error("快手下载尚未实现 — 仅支持平台识别");
  },
};
