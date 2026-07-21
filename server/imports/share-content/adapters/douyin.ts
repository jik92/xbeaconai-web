import { downloadDouyinVideo } from "../../douyin-video";
import type { ShareCandidate, SharePlatformAdapter } from "../types";

/**
 * Douyin share code pattern.
 *
 * Matches the format found in copied douyin share text:
 *   "4.66 i@C.uf :4pm kcN:/ 复制此链接，打开抖音搜索"
 *
 * The segment codes between ":" and ":/" are concatenated to form
 * the short code (e.g., "4pm" + "kcN" → "4pmkcN"), which is then
 * normalized to "https://v.douyin.com/4pmkcN/".
 *
 * Multi-candidate or ambiguous matches require user confirmation;
 * this adapter never guesses which candidate is correct.
 */
const DOUYIN_SHARE_CODE_RE = /:([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+)*)\s*:\//g;

/** Standard douyin share URL. */
const DOUYIN_URL_RE = /https:\/\/v\.douyin\.com\/[a-zA-Z0-9_-]+\/?(\?[^\s]*)?/gi;

/** Base URL for normalizing share codes. */
const DOUYIN_SHORT_LINK_BASE = "https://v.douyin.com/";

function normalizeShareCode(code: string): string {
  // Concatenate space-separated segments, clean non-alphanumeric from start/end
  const cleaned = code
    .replace(/\s+/g, "")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .replace(/[^a-zA-Z0-9]+$/, "");
  if (cleaned.length < 2) return "";
  return cleaned;
}

export const douyinAdapter: SharePlatformAdapter = {
  platformId: "douyin",
  displayName: "抖音",
  supportsDownload: true,

  extractCandidates(text: string): ShareCandidate[] {
    const candidates: ShareCandidate[] = [];

    // 1. Extract standard URLs
    const urlMatches = text.matchAll(DOUYIN_URL_RE);
    for (const match of urlMatches) {
      const url = match[0].replace(/[\s.,;!?)]+$/, ""); // strip trailing punctuation
      candidates.push({
        raw: url,
        platformId: "douyin",
        confidence: "high",
        label: `抖音链接: ${url.slice(0, 50)}…`,
      });
    }

    // 2. Extract share codes from copy-paste text
    // Reset regex state
    DOUYIN_SHARE_CODE_RE.lastIndex = 0;
    const codeMatches = text.matchAll(DOUYIN_SHARE_CODE_RE);
    for (const match of codeMatches) {
      const rawCode = match[1]?.trim();
      if (!rawCode) continue;
      const normalized = normalizeShareCode(rawCode);
      if (!normalized) continue;
      const canonicalUrl = `${DOUYIN_SHORT_LINK_BASE}${normalized}/`;
      candidates.push({
        raw: canonicalUrl,
        platformId: "douyin",
        confidence: "medium",
        label: `抖音分享码: ${normalized} → ${canonicalUrl.slice(0, 50)}…`,
      });
    }

    return candidates;
  },

  normalize(candidate: ShareCandidate): string | null {
    if (!candidate.raw.startsWith(DOUYIN_SHORT_LINK_BASE)) return null;
    try {
      const url = new URL(candidate.raw);
      if (url.hostname !== "v.douyin.com") return null;
      return candidate.raw;
    } catch {
      return null;
    }
  },

  async download(normalizedUrl: string, timeoutMs?: number) {
    const result = await downloadDouyinVideo(normalizedUrl, timeoutMs);
    return {
      filePath: result.filePath,
      tempDir: result.tempDir,
      mimeType: result.mimeType,
      byteSize: result.byteSize,
    };
  },
};
