// import type { DouyinDownloadResult } from "../douyin-video";

/** A candidate URL or share code extracted from free text. */
export interface ShareCandidate {
  /** The raw extracted string (URL, share code, or segment). */
  raw: string;
  /** The detected platform ID. */
  platformId: string;
  /** Confidence level: "high" = single clear match, "medium" = pattern matched, "low" = ambiguous. */
  confidence: "high" | "medium" | "low";
  /** Human-readable label for the candidate. */
  label: string;
}

/** Result of a successful download. */
export interface ShareDownloadResult {
  filePath: string;
  tempDir: string;
  mimeType: string;
  byteSize: number;
}

/**
 * Platform adapter interface.
 *
 * Each platform implements extraction, normalization, and optionally download.
 * Platforms that only support recognition (recognition-only) set `supportsDownload: false`
 * and throw from `download()`.
 */
export interface SharePlatformAdapter {
  readonly platformId: string;
  readonly displayName: string;
  /** Whether this platform supports actual video download. */
  readonly supportsDownload: boolean;

  /**
   * Extract candidate URLs and share codes from free-form text.
   * Returns an empty array if no candidates found.
   */
  extractCandidates(text: string): ShareCandidate[];

  /**
   * Normalize a candidate to a canonical URL suitable for download.
   * Returns null if the candidate cannot be normalized.
   */
  normalize(candidate: ShareCandidate): string | null;

  /**
   * Download the video from a normalized URL.
   * Must throw if `supportsDownload` is false.
   */
  download(normalizedUrl: string, timeoutMs?: number): Promise<ShareDownloadResult>;
}
