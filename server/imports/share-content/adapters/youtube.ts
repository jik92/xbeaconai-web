import type { ShareCandidate, SharePlatformAdapter } from "../types";

/** YouTube URL patterns — recognition only, no download. */
const YOUTUBE_URL_RE = /https:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)[a-zA-Z0-9_-]+/gi;

export const youtubeAdapter: SharePlatformAdapter = {
  platformId: "youtube",
  displayName: "YouTube",
  supportsDownload: false,

  extractCandidates(text: string): ShareCandidate[] {
    const candidates: ShareCandidate[] = [];
    YOUTUBE_URL_RE.lastIndex = 0;

    for (const match of text.matchAll(YOUTUBE_URL_RE)) {
      const url = match[0];
      candidates.push({
        raw: url,
        platformId: "youtube",
        confidence: "high",
        label: `YouTube 链接: ${url.slice(0, 50)}…`,
      });
    }

    return candidates;
  },

  normalize(candidate: ShareCandidate): string | null {
    try {
      const url = new URL(candidate.raw);
      return url.hostname.includes("youtube.com") || url.hostname === "youtu.be" ? candidate.raw : null;
    } catch {
      return null;
    }
  },

  async download(): Promise<never> {
    throw new Error("YouTube 下载尚未实现 — 仅支持平台识别");
  },
};
