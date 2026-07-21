import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const dataDir = resolve(process.env.YAOZUO_DATA_DIR ?? ".data");
const apiPort = Number(process.env.API_PORT ?? 8787);
const configuredAllowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const generatedJwtSecret = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
if (!process.env.JWT_SECRET) console.warn("JWT_SECRET 未配置：当前进程使用临时开发密钥，重启后所有登录会话失效。");
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) throw new Error("生产启动必须配置 JWT_SECRET");
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
mkdirSync(resolve(dataDir, "uploads"), { recursive: true, mode: 0o700 });
mkdirSync(resolve(dataDir, "results"), { recursive: true, mode: 0o700 });

export const env = {
  host: process.env.API_HOST ?? "127.0.0.1",
  port: apiPort,
  dataDir,
  databasePath: resolve(dataDir, "yaozuo.sqlite"),
  allowMockFallback: process.env.ALLOW_MOCK_FALLBACK !== "false",
  forceMock: process.env.FORCE_MOCK === "true",
  blockAiOutbound: process.env.BLOCK_AI_OUTBOUND === "true",
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  redisQueueName: process.env.REDIS_QUEUE_NAME ?? "yaozuo-jobs",
  workerConcurrency: Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 2)),
  // Local debugging only: set DOUYIN_BROWSER_HEADLESS=false to observe the
  // browser, and optionally pause before the downloader proceeds.
  douyinBrowserHeadless: process.env.DOUYIN_BROWSER_HEADLESS !== "false",
  douyinBrowserDebugPauseMs: Math.min(300_000, Math.max(0, Number(process.env.DOUYIN_BROWSER_DEBUG_PAUSE_MS ?? 0))),
  douyinLoginGuidanceWaitMs: Math.min(
    120_000,
    Math.max(0, Number(process.env.DOUYIN_LOGIN_GUIDANCE_WAIT_MS ?? 30_000)),
  ),
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "",
  openaiKey: process.env.OPENAI_KEY ?? "",
  videoAnalysisModel: process.env.VIDEO_ANALYSIS_MODEL ?? "gemini-3.5-flash",
  volcSpeech: {
    apiKeyId: process.env.VOLC_SPEECH_API_KEY_ID ?? "",
    apiKey: process.env.VOLC_SPEECH_API_KEY ?? "",
    baseUrl: process.env.VOLC_SPEECH_BASE_URL ?? "https://openspeech.bytedance.com",
    cloneResourceId: process.env.VOLC_SPEECH_CLONE_RESOURCE_ID ?? "seed-icl-2.0",
    ttsResourceId: process.env.VOLC_SPEECH_TTS_RESOURCE_ID ?? "seed-icl-2.0",
    presetTtsResourceId: process.env.VOLC_SPEECH_PRESET_TTS_RESOURCE_ID ?? "seed-tts-2.0",
    pollIntervalMs: Math.max(500, Number(process.env.VOLC_SPEECH_POLL_INTERVAL_MS ?? 2_000)),
    pollTimeoutMs: Math.max(10_000, Number(process.env.VOLC_SPEECH_POLL_TIMEOUT_MS ?? 180_000)),
  },
  tos: {
    accessKeyId: process.env.TOS_ACCESS_KEY_ID ?? "",
    accessKeySecret: process.env.TOS_SECRET_ACCESS_KEY ?? "",
    region: process.env.TOS_REGION ?? "cn-beijing",
    endpoint: process.env.TOS_ENDPOINT ?? "tos-cn-beijing.volces.com",
    bucket: process.env.TOS_BUCKET ?? "xbeacon",
  },
  jwtSecret: process.env.JWT_SECRET ?? generatedJwtSecret,
  authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 12),
  allowedOrigins: new Set([
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    `http://127.0.0.1:${apiPort}`,
    `http://localhost:${apiPort}`,
    ...configuredAllowedOrigins,
  ]),
};

export const tosConfigured = Boolean(
  env.tos.accessKeyId && env.tos.accessKeySecret && env.tos.region && env.tos.endpoint && env.tos.bucket,
);

if (env.host !== "127.0.0.1" && env.host !== "localhost" && env.host !== "::1") {
  throw new Error("Local development API refuses to bind a non-loopback host");
}
