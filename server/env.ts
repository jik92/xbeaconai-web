import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { APP_CONFIG } from "../web/app/config";

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
  byokEncryptionKey: process.env.BYOK_ENCRYPTION_KEY ?? "",
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  redisQueueName: process.env.REDIS_QUEUE_NAME ?? "yaozuo-jobs",
  workerConcurrency: Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 2)),
  openaiBaseUrl: APP_CONFIG.providerDefaults.openai.baseUrl,
  videoAnalysisModel: APP_CONFIG.providerDefaults.openai.videoAnalysisModel,
  volcSpeech: APP_CONFIG.providerDefaults.volcSpeech,
  mediaKit: {
    baseUrl: process.env.MEDIAKIT_BASE_URL ?? "https://mediakit.cn-beijing.volces.com",
    pollIntervalMs: Math.max(1_000, Number(process.env.MEDIAKIT_POLL_INTERVAL_MS ?? 5_000)),
    pollTimeoutMs: Math.max(30_000, Number(process.env.MEDIAKIT_POLL_TIMEOUT_MS ?? 30 * 60_000)),
  },
  tos: APP_CONFIG.providerDefaults.tos,
  jwtSecret: process.env.JWT_SECRET ?? generatedJwtSecret,
  authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 12),
  adminPhone: process.env.ADMIN_PHONE ?? "17688743518",
  smsVerificationFixedCode: process.env.SMS_VERIFICATION_FIXED_CODE ?? "",
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

if (process.env.NODE_ENV === "production" && env.smsVerificationFixedCode)
  throw new Error("生产环境禁止配置 SMS_VERIFICATION_FIXED_CODE");

if (process.env.NODE_ENV === "production" && env.byokEncryptionKey.length < 32)
  throw new Error("生产启动必须配置至少 32 字符的 BYOK_ENCRYPTION_KEY");

if (env.host !== "127.0.0.1" && env.host !== "localhost" && env.host !== "::1") {
  throw new Error("Local development API refuses to bind a non-loopback host");
}
