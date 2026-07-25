/**
 * Structured server-side execution logger for share content imports.
 *
 * SECURITY: This logger MUST NOT output share URLs, CDN URLs, cookies,
 * request headers, tokens, or any personally identifiable content.
 * All logged fields are enumerated and sanitized by the ImportLogEvent type.
 */

export type ImportStage =
  | "task_queued"
  | "task_started"
  | "validation_start"
  | "validation_complete"
  | "validation_failure"
  | "cancel_check"
  | "link_validation_start"
  | "link_validated"
  | "temp_dir_created"
  | "playwright_loading"
  | "browser_start"
  | "browser_ready"
  | "page_open_start"
  | "page_open_complete"
  | "debug_pause_start"
  | "debug_pause_complete"
  | "login_guidance_wait"
  | "login_guidance_closed"
  | "login_guidance_absent"
  | "page_settled"
  | "playback_trigger_start"
  | "playback_triggered"
  | "playback_control_absent"
  | "video_existence_check"
  | "media_capture_start"
  | "media_capture_complete"
  | "file_download_start"
  | "file_download_complete"
  | "browser_cleanup"
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
  /** Short non-sensitive explanation of the current stage. */
  message: string;
  /** Non-sensitive file size in bytes (only for download/save stages). */
  fileSizeBytes?: number;
  /** Stable error code (never contains URLs or user input). */
  errorCode?: string;
  /** Sanitized error summary — diagnostics only, no URLs/headers/cookies. */
  errorSummary?: string;
}

export const importLogPrefix = "【抖音下载】";

const stageMessages = {
  task_queued: "任务已入队",
  task_started: "开始处理任务",
  validation_start: "校验任务参数",
  validation_complete: "任务参数已确认",
  validation_failure: "任务参数无效",
  cancel_check: "检查是否取消",
  link_validation_start: "校验分享链接",
  link_validated: "分享链接有效",
  temp_dir_created: "创建临时目录",
  playwright_loading: "加载浏览器组件",
  browser_start: "启动浏览器",
  browser_ready: "浏览器已就绪",
  page_open_start: "打开抖音页面",
  page_open_complete: "页面已打开",
  debug_pause_start: "等待人工观察",
  debug_pause_complete: "结束人工观察",
  login_guidance_wait: "等待登录引导",
  login_guidance_closed: "关闭登录引导",
  login_guidance_absent: "未发现登录引导",
  page_settled: "等待页面稳定",
  playback_trigger_start: "触发视频播放",
  playback_triggered: "已触发视频播放",
  playback_control_absent: "未发现播放控件",
  video_existence_check: "检查视频状态",
  media_capture_start: "捕获视频地址",
  media_capture_complete: "视频地址已捕获",
  file_download_start: "保存视频文件",
  file_download_complete: "视频文件已保存",
  browser_cleanup: "关闭浏览器资源",
  download_start: "开始下载视频",
  download_complete: "视频下载完成",
  download_failure: "视频下载失败",
  probe_start: "校验视频文件",
  probe_complete: "视频校验完成",
  probe_failure: "视频校验失败",
  save_local_start: "保存本地文件",
  save_local_complete: "本地保存完成",
  save_local_failure: "本地保存失败",
  tos_upload_start: "上传云端存储",
  tos_upload_complete: "云端上传完成",
  tos_upload_failure: "云端上传失败",
  tos_skip: "跳过云端上传",
  asset_created: "素材已入库",
  asset_create_failure: "素材入库失败",
  success: "任务处理完成",
  cancel: "任务已取消",
  failure: "任务处理失败",
  cleanup: "清理临时文件",
} as const satisfies Record<ImportStage, string>;

/** Emit a structured log event as JSON. */
export function emitLog(event: Omit<ImportLogEvent, "message"> & { message?: string }): void {
  const message = event.message ?? stageMessages[event.stage];
  const payload: ImportLogEvent = { ...event, message };
  console.log(`${importLogPrefix} ${message} ${JSON.stringify(payload)}`);
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
