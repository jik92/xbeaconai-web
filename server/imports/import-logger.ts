/**
 * Structured server-side execution logger for share content imports.
 *
 * SECURITY: This logger MUST NOT output share URLs, CDN URLs, cookies,
 * request headers, tokens, or any personally identifiable content.
 * All logged fields are enumerated and sanitized by the ImportLogEvent type.
 */

export type ImportStage =
  | "download_start"
  | "download_complete"
  | "download_failure"
  | "probe_start"
  | "probe_complete"
  | "probe_failure"
  | "save_local_start"
  | "save_local_complete"
  | "save_local_failure"
  | "tos_upload_start"
  | "tos_upload_complete"
  | "tos_upload_failure"
  | "tos_skip"
  | "asset_created"
  | "asset_create_failure"
  | "success"
  | "cancel"
  | "failure"
  | "cleanup";

export interface ImportLogEvent {
  /** Unique job identifier for correlation. */
  jobId: string;
  /** Fixed stage name. */
  stage: ImportStage;
  /** "ok" or "error". */
  result: "ok" | "error";
  /** Elapsed milliseconds since the previous stage (or import start). */
  durationMs: number;
  /** Non-sensitive file size in bytes (only for download/save stages). */
  fileSizeBytes?: number;
  /** Stable error code (never contains URLs or user input). */
  errorCode?: string;
  /** Sanitized error summary — diagnostics only, no URLs/headers/cookies. */
  errorSummary?: string;
}

const LOG_PREFIX = "[douyin-import]";

/** Emit a structured log event as JSON. */
export function emitLog(event: ImportLogEvent): void {
  console.log(`${LOG_PREFIX} ${JSON.stringify(event)}`);
}

/** Track stage timing. Returns the start timestamp. */
export function stageStart(): number {
  return Date.now();
}

/** Compute duration and emit a stage-complete event. */
export function stageComplete(jobId: string, stage: ImportStage, startMs: number, fileSizeBytes?: number): void {
  emitLog({
    jobId,
    stage,
    result: "ok",
    durationMs: Date.now() - startMs,
    fileSizeBytes,
  });
}

/** Emit a failure log event with sanitized error info. */
export function logFailure(
  jobId: string,
  stage: ImportStage,
  startMs: number,
  errorCode: string,
  errorSummary: string,
): void {
  emitLog({
    jobId,
    stage,
    result: "error",
    durationMs: Date.now() - startMs,
    errorCode,
    errorSummary,
  });
}

/**
 * Sanitize an error for logging: extract diagnostic message but
 * strip any URLs, tokens, headers, cookies, CDN addresses, or share text.
 */
export function sanitizeError(err: unknown): {
  code: string;
  summary: string;
} {
  let msg: string;
  let code: string;

  if (err instanceof Error) {
    msg = err.message;
    code = err.name || "ERROR";
  } else if (typeof err === "string") {
    msg = err;
    code = "ERROR";
  } else if (err && typeof err === "object") {
    // Handle objects with message/code properties
    const obj = err as Record<string, unknown>;
    msg = String(obj.message ?? JSON.stringify(err));
    code = String(obj.code ?? "ERROR");
  } else {
    msg = String(err);
    code = "UNKNOWN";
  }

  // Redact URLs (http/https)
  msg = msg.replace(/https?:\/\/[^\s]+/gi, "[REDACTED_URL]");
  // Redact CDN hostnames
  msg = msg.replace(/\b[a-z0-9-]+\.douyinvod\.com\b/gi, "[REDACTED_CDN]");
  msg = msg.replace(/\b[a-z0-9-]+\.douyinstatic\.com\b/gi, "[REDACTED_CDN]");
  // Redact potential tokens (long base64/alphanumeric strings, JWT patterns)
  msg = msg.replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, "[REDACTED_TOKEN]");
  msg = msg.replace(/\b[a-zA-Z0-9+/=]{40,}\b/g, "[REDACTED_TOKEN]");
  // Redact cookie-like strings
  msg = msg.replace(/\b[a-zA-Z_][a-zA-Z0-9_]*=[^;]{8,};\s*/gi, "[REDACTED_COOKIE] ");
  // Redact common header patterns (Authorization, X-*, etc.)
  msg = msg.replace(/\b(?:Authorization|Bearer|X-\w+):\s*\S+/gi, "[REDACTED_HEADER]");
  // Redact douyin share URLs specifically
  msg = msg.replace(/v\.douyin\.com\/[a-zA-Z0-9_-]+/gi, "[REDACTED_DOUYIN_URL]");

  return {
    code: code.slice(0, 50),
    summary: msg.slice(0, 500),
  };
}
