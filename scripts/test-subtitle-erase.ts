import { mkdir, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { ossutils } from "../server/storage/ossutils";

const API_BASE_URL = (process.env.MEDIAKIT_BASE_URL ?? "https://mediakit.cn-beijing.volces.com").replace(/\/$/, "");
const TOOL = process.env.MEDIAKIT_TOOL === "enhance-video-fast" ? "enhance-video-fast" : "erase-video-subtitle-pro";
const TOOL_LABEL = TOOL === "enhance-video-fast" ? "video-enhancement" : "subtitle-erase";
const SUBMIT_PATH = `/api/v1/tools/${TOOL}`;
const POLL_INTERVAL_MS = Math.max(1_000, Number(process.env.MEDIAKIT_POLL_INTERVAL_MS ?? 5_000));
const POLL_TIMEOUT_MS = Math.max(30_000, Number(process.env.MEDIAKIT_POLL_TIMEOUT_MS ?? 30 * 60_000));
const ARTIFACTS_DIR = resolve(`artifacts/api-tests/${TOOL_LABEL}`);

type ApiError = { code?: string; message?: string; param?: string; type?: string };
type MediaKitResponse = {
  success?: boolean;
  task_id?: string;
  request_id?: string;
  status?: string;
  result?: { video_url?: string; duration?: number; resolution?: string };
  error?: ApiError;
};

class MediaKitError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

function configuredApiKeys() {
  const candidates = [
    ["MEDIAKIT_API_KEY", process.env.MEDIAKIT_API_KEY],
    ["VOLC_MEDIAKIT_API_KEY", process.env.VOLC_MEDIAKIT_API_KEY],
    ["ARK_API_KEY", process.env.ARK_API_KEY],
    ["VOLC_SPEECH_API_KEY", process.env.VOLC_SPEECH_API_KEY],
    ["TOS_ACCESS_KEY_ID", process.env.TOS_ACCESS_KEY_ID],
  ] as const;
  const seen = new Set<string>();
  return candidates.flatMap(([name, value]) => {
    const key = value?.trim();
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [{ name, key }];
  });
}

function describeError(payload: MediaKitResponse, status: number) {
  const code = payload.error?.code ?? `HTTP_${status}`;
  const message = payload.error?.message?.trim() || `AI MediaKit 返回 HTTP ${status}`;
  return new MediaKitError(code, message, status, payload.request_id);
}

async function request(path: string, apiKey: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(60_000),
  });
  let payload: MediaKitResponse;
  try {
    payload = (await response.json()) as MediaKitResponse;
  } catch {
    throw new MediaKitError("INVALID_RESPONSE", `AI MediaKit 返回了无法解析的响应（HTTP ${response.status}）`);
  }
  if (!response.ok || payload.success === false) throw describeError(payload, response.status);
  return payload;
}

async function submitWithAvailableKey(videoUrl: string) {
  const candidates = configuredApiKeys();
  if (candidates.length === 0)
    throw new MediaKitError("MEDIAKIT_API_KEY_MISSING", "未找到可探测的火山 API Key；请在 .env 配置 MEDIAKIT_API_KEY");
  const rejected: string[] = [];
  for (const candidate of candidates) {
    console.error(`[${TOOL_LABEL}] probing credential: ${candidate.name}`);
    try {
      const response = await request(SUBMIT_PATH, candidate.key, {
        method: "POST",
        body: JSON.stringify({ video_url: videoUrl }),
      });
      if (!response.task_id) throw new MediaKitError("TASK_ID_MISSING", `${TOOL_LABEL} 接口未返回 task_id`);
      return { apiKey: candidate.key, credential: candidate.name, response };
    } catch (error) {
      if (error instanceof MediaKitError && (error.status === 401 || error.status === 403)) {
        rejected.push(`${candidate.name}:${error.code}`);
        continue;
      }
      throw error;
    }
  }
  throw new MediaKitError(
    "MEDIAKIT_CREDENTIAL_REJECTED",
    `现有凭证均未获 AI MediaKit 字幕擦除权限（${rejected.join(", ")}）；请创建 MEDIAKIT_API_KEY`,
  );
}

async function waitForTask(taskId: string, apiKey: string) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const payload = await request(`/api/v1/tasks/${encodeURIComponent(taskId)}`, apiKey);
    const status = payload.status?.toLowerCase() ?? "unknown";
    console.error(`[${TOOL_LABEL}] task ${taskId}: ${status}`);
    if (["completed", "succeeded", "success"].includes(status)) return payload;
    if (["failed", "canceled", "cancelled", "error"].includes(status)) throw describeError(payload, 422);
    await Bun.sleep(POLL_INTERVAL_MS);
  }
  throw new MediaKitError("TASK_TIMEOUT", `字幕擦除任务在 ${Math.round(POLL_TIMEOUT_MS / 1_000)} 秒内未完成`);
}

function safeError(error: unknown) {
  if (error instanceof MediaKitError)
    return { code: error.code, message: error.message, httpStatus: error.status, requestId: error.requestId };
  return { code: "UNEXPECTED_ERROR", message: error instanceof Error ? error.message : String(error) };
}

const inputPath = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("用法：bun scripts/test-subtitle-erase.ts <video-path>");
const inputStat = await stat(inputPath);
if (!inputStat.isFile() || inputStat.size === 0) throw new Error(`输入不是有效视频文件：${inputPath}`);
if (!ossutils.configured) throw new Error("TOS_NOT_CONFIGURED：请先配置 TOS_ACCESS_KEY_ID 等环境变量");

await mkdir(ARTIFACTS_DIR, { recursive: true });
const startedAt = new Date().toISOString();
const sourceName = basename(inputPath, extname(inputPath));
const reportPath = resolve(ARTIFACTS_DIR, `${sourceName}.report.json`);
const outputPath = resolve(ARTIFACTS_DIR, `${sourceName}.${TOOL === "enhance-video-fast" ? "enhanced" : "erased"}.mp4`);
const bytes = new Uint8Array(await Bun.file(inputPath).arrayBuffer());
const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
let stagedKey: string | undefined;
const report: Record<string, unknown> = {
  provider: "volcengine-ai-mediakit",
  capability: TOOL,
  inputPath,
  inputBytes: inputStat.size,
  inputSha256: sha256,
  startedAt,
};

try {
  console.error(`[${TOOL_LABEL}] uploading ${basename(inputPath)} (${inputStat.size} bytes)`);
  const extension = (extname(inputPath) || ".mp4").replace(/[^a-zA-Z0-9.]/g, "");
  stagedKey = `${TOOL_LABEL}-staging/${crypto.randomUUID()}${extension}`;
  const upload = await fetch(ossutils.createSignedUploadUrl(stagedKey, 15 * 60), {
    method: "PUT",
    body: bytes.buffer as ArrayBuffer,
    signal: AbortSignal.timeout(3 * 60_000),
  });
  if (!upload.ok) throw new Error(`TOS_UPLOAD_FAILED: HTTP ${upload.status}`);
  const signedUrl = ossutils.createSignedReadUrl(stagedKey, 24 * 60 * 60);
  console.error(`[${TOOL_LABEL}] upload complete; submitting real MediaKit task`);
  const submitted = await submitWithAvailableKey(signedUrl);
  report.credential = submitted.credential;
  report.taskId = submitted.response.task_id;
  report.requestId = submitted.response.request_id;
  const taskId = submitted.response.task_id;
  if (!taskId) throw new MediaKitError("TASK_ID_MISSING", "字幕擦除接口未返回 task_id");
  const completed = await waitForTask(taskId, submitted.apiKey);
  const resultUrl = completed.result?.video_url;
  if (!resultUrl) throw new MediaKitError("RESULT_URL_MISSING", "已完成任务未返回 result.video_url");
  console.error(`[${TOOL_LABEL}] downloading result`);
  const download = await fetch(resultUrl, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!download.ok) throw new MediaKitError("RESULT_DOWNLOAD_FAILED", `结果下载返回 HTTP ${download.status}`);
  const output = new Uint8Array(await download.arrayBuffer());
  if (output.byteLength === 0) throw new MediaKitError("RESULT_EMPTY", "字幕擦除结果文件为空");
  await Bun.write(outputPath, output);
  report.status = "verified";
  report.outputPath = outputPath;
  report.outputBytes = output.byteLength;
  report.outputSha256 = new Bun.CryptoHasher("sha256").update(output).digest("hex");
  report.duration = completed.result?.duration;
  report.resolution = completed.result?.resolution;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.status = "failed";
  report.error = safeError(error);
  throw error;
} finally {
  report.completedAt = new Date().toISOString();
  if (stagedKey) {
    await ossutils.markCleanupReady(stagedKey).catch(() => undefined);
    await ossutils.deleteObject(stagedKey).catch(() => undefined);
  }
  await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(`[${TOOL_LABEL}] report: ${reportPath}`);
}
