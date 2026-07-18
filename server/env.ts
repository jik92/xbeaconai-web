import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const dataDir = resolve(process.env.YAOZUO_DATA_DIR ?? ".data");
const generatedJwtSecret = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
if (!process.env.JWT_SECRET) console.warn("JWT_SECRET 未配置：当前进程使用临时开发密钥，重启后所有登录会话失效。");
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) throw new Error("生产启动必须配置 JWT_SECRET");
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
mkdirSync(resolve(dataDir, "uploads"), { recursive: true, mode: 0o700 });
mkdirSync(resolve(dataDir, "results"), { recursive: true, mode: 0o700 });

export const env = {
  host: process.env.API_HOST ?? "127.0.0.1",
  port: Number(process.env.API_PORT ?? 8787),
  dataDir,
  databasePath: resolve(dataDir, "yaozuo.sqlite"),
  allowMockFallback: process.env.ALLOW_MOCK_FALLBACK !== "false",
  forceMock: process.env.FORCE_MOCK === "true",
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "",
  openaiKey: process.env.OPENAI_KEY ?? "",
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
    `http://127.0.0.1:${Number(process.env.API_PORT ?? 8787)}`,
    `http://localhost:${Number(process.env.API_PORT ?? 8787)}`,
  ]),
};

export const tosConfigured = Boolean(env.tos.accessKeyId && env.tos.accessKeySecret && env.tos.region && env.tos.endpoint && env.tos.bucket);

if (env.host !== "127.0.0.1" && env.host !== "localhost" && env.host !== "::1") {
  throw new Error("Local development API refuses to bind a non-loopback host");
}
