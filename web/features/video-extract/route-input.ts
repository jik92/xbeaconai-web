import type { ShareCandidate } from "@/api/api-client";

/**
 * Result of classifying user input for routing to the correct job type.
 */
export type RouteDecision =
  | { kind: "video-extract"; url: string }
  | { kind: "share-import"; candidate: ShareCandidate }
  | { kind: "multi-candidate"; candidates: ShareCandidate[] }
  | { kind: "invalid"; reason: string }
  | { kind: "empty" };

/**
 * Validate that a trimmed string is a legal http/https URL suitable
 * for the video-extract worker.  Rejects plain text, invalid URLs,
 * and non-http(s) schemes (ftp, javascript, data, file, etc.).
 */
function isValidHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Pure function: given parsed share candidates and the raw input text,
 * decide whether to create a video-extract job, a share-content-import job,
 * or require the user to pick from multiple candidates.
 *
 * - Multiple candidates → user must confirm (never auto-select).
 * - Single candidate → auto-route to share-content-import.
 * - No candidates + valid http/https URL → video-extract.
 * - No candidates + plain text / invalid URL / non-http(s) → invalid.
 * - Empty/whitespace input → empty (caller should show validation error).
 */
export function classifyInput(candidates: ShareCandidate[], rawText: string): RouteDecision {
  const trimmed = rawText.trim();

  if (trimmed.length === 0) return { kind: "empty" };

  if (candidates.length > 1) {
    return { kind: "multi-candidate", candidates };
  }

  if (candidates.length === 1) {
    return { kind: "share-import", candidate: candidates[0] };
  }

  // No platform candidates — only allow valid http/https URLs
  if (isValidHttpUrl(trimmed)) {
    return { kind: "video-extract", url: trimmed };
  }

  return {
    kind: "invalid",
    reason: "请输入有效的 http/https 视频链接，或包含平台分享链接的内容",
  };
}
