import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { APP_CONFIG } from "../web/app/config";

const dataDir = resolve(process.env.YAOZUO_DATA_DIR ?? ".data");
const apiPort = Number(process.env.API_PORT ?? 8787);
const positiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
export function resolveWorkerConcurrencies(input: { network?: string; ffmpeg?: string; legacy?: string }) {
  const legacy = input.legacy === undefined ? undefined : positiveInteger(input.legacy, 2);
  return {
    network: positiveInteger(input.network, legacy ?? 40),
    ffmpeg: positiveInteger(input.ffmpeg, legacy ?? 2),
  };
}
export function resolveTosConfig(input: {
  isProduction: boolean;
  region?: string;
  bucket?: string;
  serverEndpoint?: string;
  publicEndpoint?: string;
  corsOrigins?: string;
}) {
  const defaults = APP_CONFIG.providerDefaults.tos;
  const requiredProductionValues = {
    TOS_REGION: input.region?.trim(),
    TOS_BUCKET: input.bucket?.trim(),
    TOS_SERVER_ENDPOINT: input.serverEndpoint?.trim(),
    TOS_PUBLIC_ENDPOINT: input.publicEndpoint?.trim(),
    TOS_CORS_ORIGINS: input.corsOrigins?.trim(),
  };
  if (input.isProduction) {
    const missing = Object.entries(requiredProductionValues)
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length) throw new Error(`生产启动必须配置 ${missing.join("、")}`);
  }
  const localCorsOrigins = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
  ];
  const config = {
    region: input.region?.trim() || defaults.region,
    bucket: input.bucket?.trim() || defaults.bucket,
    serverEndpoint: input.serverEndpoint?.trim() || defaults.endpoint,
    publicEndpoint: input.publicEndpoint?.trim() || defaults.endpoint,
    corsOrigins: [
      ...new Set(
        input.corsOrigins
          ? input.corsOrigins
              .split(",")
              .map((origin) => origin.trim())
              .filter(Boolean)
          : localCorsOrigins,
      ),
    ],
  };
  if (!config.corsOrigins.length) throw new Error("TOS_CORS_ORIGINS 至少需要一个 Origin");
  const expectedPublicEndpoint = `tos-${config.region}.volces.com`;
  const expectedServerEndpoint = input.isProduction ? `tos-${config.region}.ivolces.com` : expectedPublicEndpoint;
  if (config.serverEndpoint !== expectedServerEndpoint)
    throw new Error(
      input.isProduction
        ? `生产 TOS_SERVER_ENDPOINT 必须是 ${expectedServerEndpoint}`
        : `本地 TOS_SERVER_ENDPOINT 必须是 ${expectedServerEndpoint}`,
    );
  if (config.publicEndpoint !== expectedPublicEndpoint)
    throw new Error(`TOS_PUBLIC_ENDPOINT 必须是 ${expectedPublicEndpoint}`);
  return config;
}
export function resolvePublicMediaConfig(input: { isProduction: boolean; baseUrl?: string }) {
  const productionOrigin = "https://files.xbeaconai.com";
  const rawBaseUrl = input.baseUrl?.trim();
  if (!rawBaseUrl) {
    if (input.isProduction) throw new Error("生产启动必须配置 PUBLIC_MEDIA_BASE_URL");
    return {
      baseUrl: productionOrigin,
      origin: productionOrigin,
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    throw new Error("PUBLIC_MEDIA_BASE_URL 必须是有效的 HTTPS 域名根地址");
  }
  if (parsed.protocol !== "https:") throw new Error("PUBLIC_MEDIA_BASE_URL 必须使用 HTTPS");
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash)
    throw new Error("PUBLIC_MEDIA_BASE_URL 只能配置域名根地址");
  if (input.isProduction && parsed.origin !== productionOrigin)
    throw new Error(`生产 PUBLIC_MEDIA_BASE_URL 必须是 ${productionOrigin}`);
  return {
    baseUrl: parsed.origin,
    origin: parsed.origin,
  };
}
const workerConcurrencies = resolveWorkerConcurrencies({
  network: process.env.NETWORK_WORKER_CONCURRENCY,
  ffmpeg: process.env.FFMPEG_WORKER_CONCURRENCY,
  legacy: process.env.WORKER_CONCURRENCY,
});
const configuredAllowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
export const parseAdminPhones = (value: string) =>
  new Set(
    value
      .split(",")
      .map((phone) => phone.trim())
      .filter(Boolean),
  );
const configuredAdminPhones = parseAdminPhones(process.env.ADMIN_PHONE ?? "17688743518");
const generatedJwtSecret = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
if (!process.env.JWT_SECRET) console.warn("JWT_SECRET 未配置：当前进程使用临时开发密钥，重启后所有登录会话失效。");
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) throw new Error("生产启动必须配置 JWT_SECRET");
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
mkdirSync(resolve(dataDir, "uploads"), { recursive: true, mode: 0o700 });
mkdirSync(resolve(dataDir, "results"), { recursive: true, mode: 0o700 });

export const env = {
  isProduction: process.env.NODE_ENV === "production",
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
  networkWorkerConcurrency: workerConcurrencies.network,
  ffmpegWorkerConcurrency: workerConcurrencies.ffmpeg,
  // Local debugging only: set DOUYIN_BROWSER_HEADLESS=false to observe the
  // browser, and optionally pause before the downloader proceeds.
  douyinBrowserHeadless: process.env.DOUYIN_BROWSER_HEADLESS !== "false",
  douyinBrowserDebugPauseMs: Math.min(300_000, Math.max(0, Number(process.env.DOUYIN_BROWSER_DEBUG_PAUSE_MS ?? 0))),
  douyinLoginGuidanceWaitMs: Math.min(
    120_000,
    Math.max(0, Number(process.env.DOUYIN_LOGIN_GUIDANCE_WAIT_MS ?? 30_000)),
  ),
  videoAnalysisModel: APP_CONFIG.providerDefaults.openai.videoAnalysisModel,
  volcSpeech: APP_CONFIG.providerDefaults.volcSpeech,
  mediaKit: {
    baseUrl: process.env.MEDIAKIT_BASE_URL ?? "https://mediakit.cn-beijing.volces.com",
    pollIntervalMs: Math.max(1_000, Number(process.env.MEDIAKIT_POLL_INTERVAL_MS ?? 5_000)),
    pollTimeoutMs: Math.max(30_000, Number(process.env.MEDIAKIT_POLL_TIMEOUT_MS ?? 30 * 60_000)),
  },
  tos: resolveTosConfig({
    isProduction: process.env.NODE_ENV === "production",
    region: process.env.TOS_REGION,
    bucket: process.env.TOS_BUCKET,
    serverEndpoint: process.env.TOS_SERVER_ENDPOINT,
    publicEndpoint: process.env.TOS_PUBLIC_ENDPOINT,
    corsOrigins: process.env.TOS_CORS_ORIGINS,
  }),
  publicMedia: resolvePublicMediaConfig({
    isProduction: process.env.NODE_ENV === "production",
    baseUrl: process.env.PUBLIC_MEDIA_BASE_URL,
  }),
  jwtSecret: process.env.JWT_SECRET ?? generatedJwtSecret,
  authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 12),
  adminPhones: configuredAdminPhones,
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
