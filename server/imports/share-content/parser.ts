import type { ShareCandidate, SharePlatformAdapter } from "./types";

/**
 * Parses free-form text into platform-specific share candidates.
 *
 * Iterates through all registered platform adapters and aggregates
 * extraction results. The caller (UI) then presents candidates for
 * user confirmation before creating an import job.
 */
export class ShareContentParser {
  constructor(private readonly adapters: readonly SharePlatformAdapter[]) {}

  /**
   * Parse text and return all candidate matches across platforms.
   * Sorted by confidence (high → medium → low).
   */
  parse(text: string): ShareCandidate[] {
    const trimmed = text.trim();
    if (!trimmed) return [];

    const candidates: ShareCandidate[] = [];
    for (const adapter of this.adapters) {
      try {
        candidates.push(...adapter.extractCandidates(trimmed));
      } catch {
        // Adapter extraction failures should not block other adapters
      }
    }

    // Sort by confidence
    const order = { high: 0, medium: 1, low: 2 } as const;
    return candidates.sort((a, b) => order[a.confidence] - order[b.confidence]);
  }

  /** Find the adapter for a given platform ID. */
  adapterFor(platformId: string): SharePlatformAdapter | undefined {
    return this.adapters.find((a) => a.platformId === platformId);
  }

  /** List all adapters that support download. */
  get downloadableAdapters(): SharePlatformAdapter[] {
    return this.adapters.filter((a) => a.supportsDownload);
  }
}
