import { mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { APP_CONFIG, isModuleOpen } from "../src/app/config";
import type { ModuleId } from "../src/entities/types";
import {
  AccountError,
  AccountStore,
  type MediaAsset,
  type Preferences,
  rechargePackages,
} from "./accounts/account-store";
import { authenticate, issueToken } from "./accounts/auth";
import { creationCapabilities, quoteCreation, validateCreationValues } from "./creation/capabilities";
import { env } from "./env";
import { buildExecutionPlan, MemoryJobQueue } from "./jobs/memory-job-queue";
import { InsufficientCreditsError, SqliteJobStore } from "./jobs/sqlite-job-store";
import { seedanceModelIds, videoModels } from "./models/video-models";
import { auditSdkRegistry } from "./sdk-registry";
import { ossutils } from "./storage/ossutils";
import type { JobRecord, StageProvenance } from "./types";
import {
  directUploadExtensions,
  issueDirectUploadTicket,
  maxDirectUploadBytes,
  verifyDirectUploadTicket,
} from "./uploads/direct-upload";

const moduleIds = [
  "video-remix",
  "video-create",
  "ad-script",
  "ai-generate",
  "video-cut",
  "media-understand",
  "video-mashup",
  "voice-clone",
  "video-renewal",
  "subtitle-erase",
  "video-enhancement",
  "kickart",
] as const;
const ModuleSchema = z.enum(moduleIds).openapi("ModuleId");
const VideoModelIdSchema = z.enum(seedanceModelIds).openapi("SeedanceModelId");
const JobStatusSchema = z.enum(["queued", "processing", "succeeded", "partially_succeeded", "failed", "cancelled"]);
const StageSchema = z.object({
  id: z.string(),
  capability: z.string(),
  executionMode: z.enum(["real", "local", "mock"]),
  implementation: z.string(),
  provider: z.string().optional(),
  model: z.string().optional(),
  fallbackReason: z.string().optional(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
});
const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  requestId: z.string(),
});
const ArtifactSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  url: z.string().optional(),
  text: z.string().optional(),
  executionMode: z.enum(["real", "local", "mock", "mixed"]),
  lineage: z.array(StageSchema),
});
const JobResultSchema = z.object({
  kind: z.string(),
  title: z.string(),
  summary: z.string(),
  artifacts: z.array(ArtifactSchema),
  data: z.object({ values: z.record(z.string(), z.string()), generatedAt: z.string(), mock: z.boolean() }).optional(),
});
const JobSchema = z
  .object({
    id: z.string(),
    moduleId: ModuleSchema,
    title: z.string(),
    status: JobStatusSchema,
    progress: z.number().int().min(0).max(100),
    stage: z.string(),
    overallExecutionMode: z.enum(["real", "local", "mock", "mixed"]),
    values: z.record(z.string(), z.string()),
    videoModel: VideoModelIdSchema.optional(),
    executionPlan: z.array(StageSchema),
    provenance: z.array(StageSchema),
    result: JobResultSchema.optional(),
    error: ApiErrorSchema.optional(),
    parentJobId: z.string().optional(),
    cancelRequested: z.boolean(),
    providerModel: VideoModelIdSchema.optional(),
    providerTaskId: z.string().optional(),
    providerStatus: z.string().optional(),
    providerSubmittedAt: z.string().optional(),
    providerDeadlineAt: z.string().optional(),
    providerCancelState: z.enum(["none", "requested", "unsupported", "failed"]).optional(),
    stagingKeys: z.array(z.string()),
    jobSchemaVersion: z.union([z.literal(1), z.literal(2)]),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("Job");
const ErrorSchema = z.object({ error: ApiErrorSchema }).openapi("ApiErrorResponse");
const AssetKindSchema = z.enum(["media", "product", "portrait", "voice"]).openapi("AssetKind");
const LibraryAssetSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  durationSec: z.number().optional(),
  kind: AssetKindSchema,
  description: z.string().optional(),
  folderId: z.string().uuid().optional(),
  url: z.string(),
  createdAt: z.string(),
});
const DirectUploadRequestSchema = z.object({
  fileName: z.string().min(1).max(200),
  mimeType: z.string().min(1),
  size: z.number().int().min(1).max(maxDirectUploadBytes),
  width: z.number().int().min(1).optional(),
  height: z.number().int().min(1).optional(),
  durationSec: z.number().min(0).optional(),
  displayName: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  folderId: z.string().uuid().optional(),
});
const DirectUploadInitSchema = z.object({
  uploadUrl: z.string().url(),
  uploadToken: z.string().min(1),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string(),
});

export const store = new SqliteJobStore();
export const accounts = new AccountStore();
export const queue = new MemoryJobQueue(store, accounts);
type AppEnv = { Variables: { userId: string; sessionId: string } };
const app = new OpenAPIHono<AppEnv>();
const publicApiPaths = new Set([
  "/api/health",
  "/api/capabilities",
  "/api/models",
  "/api/creation/capabilities",
  "/api/auth/register",
  "/api/auth/login",
  "/api/auth/logout",
]);

function referencedAssetIds(values: Record<string, string>) {
  const ids = new Set<string>();
  for (const value of Object.values(values)) {
    if (value.startsWith("asset:")) {
      const id = value.split(":", 3)[1];
      if (id) ids.add(id);
    }
    if (value.startsWith("assets:"))
      try {
        const items = JSON.parse(value.slice(7)) as Array<{ id?: unknown }>;
        for (const item of items) if (typeof item?.id === "string" && !item.id.startsWith("library-")) ids.add(item.id);
      } catch {
        /* invalid structured values are handled as ordinary form values */
      }
  }
  return [...ids];
}

function getVerifiedSdkIds(): Set<string> {
  const verified = new Set<string>();
  for (const file of ["capabilities.json", "ffmpeg-capabilities.json"])
    try {
      const body = JSON.parse(readFileSync(resolve(env.dataDir, file), "utf8")) as {
        entries?: Array<{ id: string; status: string }>;
      };
      for (const item of body.entries ?? [])
        if (item.status === "verified" || item.status === "local") verified.add(item.id);
    } catch {
      /* report not generated yet */
    }
  return verified;
}

function videoModelEnabled(modelId: string) {
  if (env.forceMock) return true;
  const sdk = auditSdkRegistry().find((item) => item.model === modelId && item.capability === "video-generate");
  return Boolean(sdk && getVerifiedSdkIds().has(sdk.id));
}

app.use(
  "/api/*",
  cors({
    origin: (origin) => (env.allowedOrigins.has(origin) ? origin : ""),
    allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "Last-Event-ID"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "OPTIONS"],
    credentials: false,
  }),
);

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  c.header("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
});

app.use("/api/*", async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin && !env.allowedOrigins.has(origin))
    return c.json(
      {
        error: {
          code: "ORIGIN_NOT_ALLOWED",
          message: "请求来源不受信任",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      403,
    );
  if (c.req.method === "OPTIONS" || publicApiPaths.has(c.req.path)) return next();
  const identity = await authenticate(accounts, c.req.header("Authorization"));
  if (!identity)
    return c.json(
      {
        error: {
          code: "AUTHENTICATION_FAILED",
          message: "登录已失效，请重新登录",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      401,
    );
  c.set("userId", identity.user.id);
  c.set("sessionId", identity.sessionId);
  await next();
});

const healthRoute = createRoute({
  method: "get",
  path: "/api/health",
  operationId: "getHealth",
  responses: {
    200: {
      description: "Service health",
      content: {
        "application/json": {
          schema: z.object({
            status: z.literal("ok"),
            mockFallback: z.boolean(),
            database: z.literal("sqlite"),
            queue: z.literal("memory"),
          }),
        },
      },
    },
  },
});
app.openapi(healthRoute, (c) =>
  c.json(
    {
      status: "ok" as const,
      mockFallback: env.allowMockFallback,
      database: "sqlite" as const,
      queue: "memory" as const,
    },
    200,
  ),
);

const UserSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    displayName: z.string(),
    avatarText: z.string(),
    credits: z.number().int().nonnegative(),
  })
  .openapi("UserSummary");
const AuthSchema = z
  .object({ token: z.string(), tokenType: z.literal("Bearer"), expiresAt: z.string(), user: UserSchema })
  .openapi("AuthResponse");
const PasswordSchema = z
  .string()
  .min(10)
  .max(128)
  .regex(/[A-Za-z]/, "密码必须包含字母")
  .regex(/[0-9]/, "密码必须包含数字");
const authRate = new Map<string, { count: number; reset: number }>();
function rateLimited(key: string) {
  const time = Date.now(),
    entry = authRate.get(key);
  if (!entry || entry.reset < time) {
    authRate.set(key, { count: 1, reset: time + 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > env.authRateLimitMax;
}

const registerRoute = createRoute({
  method: "post",
  path: "/api/auth/register",
  operationId: "register",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            email: z.string().email().max(254),
            password: PasswordSchema,
            displayName: z.string().trim().min(2).max(40),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: "Registered", content: { "application/json": { schema: AuthSchema } } },
    409: { description: "Email exists", content: { "application/json": { schema: ErrorSchema } } },
    422: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    429: { description: "Rate limited", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(registerRoute, async (c) => {
  if (rateLimited(`register:${c.req.header("x-forwarded-for") ?? "local"}`))
    return c.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "操作过于频繁，请稍后再试",
          retryable: true,
          requestId: crypto.randomUUID(),
        },
      },
      429,
    );
  try {
    const registration = await accounts.register(c.req.valid("json"));
    const materialFolder = accounts.ensureDefaultAssetFolder(registration.user.id);
    mkdirSync(resolve(env.dataDir, "uploads", materialFolder.storagePrefix), { recursive: true, mode: 0o700 });
    if (ossutils.configured)
      await Promise.all([
        ossutils.ensureDirectory(`${registration.user.id}/`),
        ossutils.ensureDirectory(materialFolder.storagePrefix),
      ]).catch((error) => console.error("Failed to initialize user TOS directories", error));
    if (registration.claimedLegacy) queue.recoverOwned(registration.user.id);
    return c.json(await issueToken(accounts, registration.user), 201);
  } catch (error) {
    if (error instanceof AccountError && error.status === 409)
      return c.json(
        { error: { code: error.code, message: error.message, retryable: false, requestId: crypto.randomUUID() } },
        409,
      );
    throw error;
  }
});

const loginRoute = createRoute({
  method: "post",
  path: "/api/auth/login",
  operationId: "login",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ email: z.string().email(), password: z.string().min(1).max(128) }) },
      },
    },
  },
  responses: {
    200: { description: "Logged in", content: { "application/json": { schema: AuthSchema } } },
    401: { description: "Invalid credentials", content: { "application/json": { schema: ErrorSchema } } },
    429: { description: "Rate limited", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(loginRoute, async (c) => {
  if (rateLimited(`login:${c.req.header("x-forwarded-for") ?? "local"}`))
    return c.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "登录尝试过多，请稍后再试",
          retryable: true,
          requestId: crypto.randomUUID(),
        },
      },
      429,
    );
  try {
    const body = c.req.valid("json"),
      user = await accounts.verifyCredentials(body.email, body.password);
    return c.json(await issueToken(accounts, user), 200);
  } catch (error) {
    if (error instanceof AccountError)
      return c.json(
        { error: { code: error.code, message: error.message, retryable: false, requestId: crypto.randomUUID() } },
        401,
      );
    throw error;
  }
});

const logoutRoute = createRoute({
  method: "post",
  path: "/api/auth/logout",
  operationId: "logout",
  responses: {
    204: { description: "Logged out" },
    401: { description: "Invalid token", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(logoutRoute, async (c) => {
  const identity = await authenticate(accounts, c.req.header("Authorization"), true);
  if (!identity)
    return c.json(
      {
        error: {
          code: "AUTHENTICATION_FAILED",
          message: "登录凭据无效",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      401,
    );
  accounts.revokeSession(identity.sessionId);
  return c.body(null, 204);
});

const meRoute = createRoute({
  method: "get",
  path: "/api/auth/me",
  operationId: "getCurrentUser",
  responses: {
    200: { description: "Current user", content: { "application/json": { schema: z.object({ user: UserSchema }) } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(meRoute, (c) => c.json({ user: accounts.getUser(c.get("userId"))! }, 200));

const profileRoute = createRoute({
  method: "patch",
  path: "/api/account/profile",
  operationId: "updateProfile",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            email: z.string().email().max(254),
            displayName: z.string().trim().min(2).max(40),
            avatarText: z.string().trim().min(1).max(2),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Updated profile",
      content: { "application/json": { schema: z.object({ user: UserSchema }) } },
    },
    409: { description: "Email exists", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(profileRoute, (c) => {
  try {
    return c.json({ user: accounts.updateProfile(c.get("userId"), c.req.valid("json")) }, 200);
  } catch (error) {
    if (error instanceof AccountError)
      return c.json(
        { error: { code: error.code, message: error.message, retryable: false, requestId: crypto.randomUUID() } },
        409,
      );
    throw error;
  }
});

const changePasswordRoute = createRoute({
  method: "post",
  path: "/api/account/change-password",
  operationId: "changePassword",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ currentPassword: z.string().min(1).max(128), newPassword: PasswordSchema }),
        },
      },
    },
  },
  responses: {
    204: { description: "Password changed" },
    400: { description: "Invalid current password", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(changePasswordRoute, async (c) => {
  try {
    const body = c.req.valid("json");
    await accounts.changePassword(c.get("userId"), body.currentPassword, body.newPassword);
    return c.body(null, 204);
  } catch (error) {
    if (error instanceof AccountError)
      return c.json(
        { error: { code: error.code, message: error.message, retryable: false, requestId: crypto.randomUUID() } },
        400,
      );
    throw error;
  }
});

const PreferencesSchema = z
  .object({
    theme: z.enum(["light", "system"]),
    defaultRatio: z.enum(["9:16", "16:9", "1:1"]),
    language: z.enum(["zh-CN", "en"]),
    taskNotifications: z.boolean(),
    autoplayResults: z.boolean(),
  })
  .openapi("Preferences");
const preferencesGetRoute = createRoute({
  method: "get",
  path: "/api/preferences",
  operationId: "getPreferences",
  responses: { 200: { description: "Preferences", content: { "application/json": { schema: PreferencesSchema } } } },
});
app.openapi(preferencesGetRoute, (c) => c.json(accounts.getPreferences(c.get("userId")), 200));
const preferencesPutRoute = createRoute({
  method: "put",
  path: "/api/preferences",
  operationId: "savePreferences",
  request: { body: { required: true, content: { "application/json": { schema: PreferencesSchema } } } },
  responses: {
    200: { description: "Saved preferences", content: { "application/json": { schema: PreferencesSchema } } },
  },
});
app.openapi(preferencesPutRoute, (c) =>
  c.json(accounts.savePreferences(c.get("userId"), c.req.valid("json") as Preferences), 200),
);

const NotificationSchema = z
  .object({
    id: z.string().uuid(),
    type: z.string(),
    title: z.string(),
    body: z.string(),
    readAt: z.string().optional(),
    createdAt: z.string(),
  })
  .openapi("NotificationItem");
const notificationsRoute = createRoute({
  method: "get",
  path: "/api/notifications",
  operationId: "listNotifications",
  responses: {
    200: {
      description: "Notifications",
      content: {
        "application/json": {
          schema: z.object({ notifications: z.array(NotificationSchema), unreadCount: z.number().int() }),
        },
      },
    },
  },
});
app.openapi(notificationsRoute, (c) => c.json(accounts.listNotifications(c.get("userId")), 200));
const readNotificationRoute = createRoute({
  method: "post",
  path: "/api/notifications/{notificationId}/read",
  operationId: "markNotificationRead",
  request: { params: z.object({ notificationId: z.string().uuid() }) },
  responses: {
    200: {
      description: "Read",
      content: { "application/json": { schema: z.object({ unreadCount: z.number().int() }) } },
    },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(readNotificationRoute, (c) => {
  try {
    return c.json(
      { unreadCount: accounts.markNotification(c.get("userId"), c.req.valid("param").notificationId) },
      200,
    );
  } catch (error) {
    return c.json(
      { error: { code: "NOT_FOUND", message: "通知不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  }
});
const readAllRoute = createRoute({
  method: "post",
  path: "/api/notifications/read-all",
  operationId: "markAllNotificationsRead",
  responses: {
    200: {
      description: "All read",
      content: { "application/json": { schema: z.object({ unreadCount: z.literal(0) }) } },
    },
  },
});
app.openapi(readAllRoute, (c) => c.json({ unreadCount: accounts.markAllNotifications(c.get("userId")) as 0 }, 200));

const PackageSchema = z.object({
  id: z.string(),
  name: z.string(),
  amountCny: z.number().int(),
  credits: z.number().int(),
  badge: z.string(),
});
const OrderSchema = z
  .object({
    id: z.string().uuid(),
    packageId: z.string(),
    amountCny: z.number().int(),
    credits: z.number().int(),
    status: z.literal("succeeded"),
    paymentMode: z.literal("mock"),
    balanceAfter: z.number().int(),
    createdAt: z.string(),
  })
  .openapi("RechargeOrder");
const packagesRoute = createRoute({
  method: "get",
  path: "/api/recharge/packages",
  operationId: "listRechargePackages",
  responses: {
    200: {
      description: "Packages",
      content: { "application/json": { schema: z.object({ packages: z.array(PackageSchema) }) } },
    },
  },
});
app.openapi(packagesRoute, (c) => c.json({ packages: [...rechargePackages] }, 200));
const ordersRoute = createRoute({
  method: "get",
  path: "/api/recharge/orders",
  operationId: "listRechargeOrders",
  responses: {
    200: {
      description: "Orders",
      content: { "application/json": { schema: z.object({ orders: z.array(OrderSchema) }) } },
    },
  },
});
app.openapi(ordersRoute, (c) => c.json({ orders: accounts.listOrders(c.get("userId")) }, 200));
const createOrderRoute = createRoute({
  method: "post",
  path: "/api/recharge/orders",
  operationId: "createRechargeOrder",
  request: {
    body: { required: true, content: { "application/json": { schema: z.object({ packageId: z.string() }) } } },
  },
  responses: {
    201: {
      description: "Recharged",
      content: { "application/json": { schema: z.object({ order: OrderSchema, user: UserSchema }) } },
    },
    400: { description: "Missing key", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Package not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Idempotency conflict", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(createOrderRoute, (c) => {
  const key = c.req.header("Idempotency-Key")?.slice(0, 128);
  if (!key)
    return c.json(
      {
        error: {
          code: "IDEMPOTENCY_KEY_REQUIRED",
          message: "缺少幂等键",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      400,
    );
  try {
    const order = accounts.recharge(c.get("userId"), c.req.valid("json").packageId, key);
    return c.json({ order, user: accounts.getUser(c.get("userId"))! }, 201);
  } catch (error) {
    if (error instanceof AccountError && error.status === 404)
      return c.json(
        { error: { code: error.code, message: error.message, retryable: false, requestId: crypto.randomUUID() } },
        404,
      );
    if (error instanceof AccountError)
      return c.json(
        { error: { code: error.code, message: error.message, retryable: false, requestId: crypto.randomUUID() } },
        409,
      );
    throw error;
  }
});

const capabilitiesRoute = createRoute({
  method: "get",
  path: "/api/capabilities",
  operationId: "getCapabilities",
  responses: {
    200: {
      description: "Executable capabilities",
      content: {
        "application/json": {
          schema: z.object({
            capabilities: z.array(
              z.object({
                id: z.string(),
                capability: z.string(),
                executionMode: z.enum(["real", "local", "mock"]),
                provider: z.string().optional(),
                model: z.string().optional(),
              }),
            ),
          }),
        },
      },
    },
  },
});
app.openapi(capabilitiesRoute, (c) => {
  const verified = getVerifiedSdkIds();
  const capabilities = auditSdkRegistry()
    .filter((item) => item.kind === "mock" || verified.has(item.id))
    .map((item) => ({
      id: item.id,
      capability: item.capability,
      executionMode: (item.kind === "model" ? "real" : item.kind === "ffmpeg" ? "local" : "mock") as
        | "real"
        | "local"
        | "mock",
      provider: item.provider,
      model: item.model,
    }));
  return c.json({ capabilities }, 200);
});

const modelsRoute = createRoute({
  method: "get",
  path: "/api/models",
  operationId: "getModels",
  responses: {
    200: {
      description: "Approved model catalog",
      content: {
        "application/json": {
          schema: z.object({
            models: z.array(
              z.object({
                id: z.string(),
                provider: z.string(),
                capability: z.string(),
                executionMode: z.literal("real"),
                name: z.string(),
                description: z.string(),
                tags: z.array(z.string()),
                referenceCapabilities: z.array(z.enum(["image", "video", "audio"])),
                defaults: z.object({
                  resolution: z.enum(["480p", "720p"]),
                  ratio: z.string(),
                  duration: z.number().int(),
                  generateAudio: z.boolean(),
                  watermark: z.boolean(),
                }),
                isDefault: z.boolean(),
                enabled: z.boolean(),
                realTestStatus: z.enum(["verified", "pending", "failed"]),
              }),
            ),
          }),
        },
      },
    },
  },
});
app.openapi(modelsRoute, (c) => {
  const verified = getVerifiedSdkIds();
  const registry = auditSdkRegistry();
  const otherModels = registry
    .filter((item) => item.kind === "model" && item.capability !== "video-generate" && verified.has(item.id))
    .map((item) => ({
      id: item.model!,
      provider: item.provider!,
      capability: item.capability,
      executionMode: "real" as const,
      name: item.model!,
      description: "已验证模型",
      tags: [],
      referenceCapabilities: [] as Array<"image" | "video" | "audio">,
      defaults: { resolution: "720p" as const, ratio: "16:9", duration: 5, generateAudio: false, watermark: false },
      isDefault: false,
      enabled: true,
      realTestStatus: "verified" as const,
    }));
  const videos = videoModels.map((model) => {
    const sdk = registry.find((item) => item.model === model.id);
    const passed = Boolean(sdk && verified.has(sdk.id));
    return {
      ...model,
      executionMode: "real" as const,
      enabled: env.forceMock || passed,
      realTestStatus: passed ? ("verified" as const) : ("pending" as const),
    };
  });
  return c.json({ models: [...otherModels, ...videos] }, 200);
});

const creationModelSchema = z.object({
  id: z.string(),
  kind: z.enum(["image", "video"]),
  displayName: z.string(),
  description: z.string(),
  badges: z.array(z.string()),
  enabled: z.boolean(),
  disabledReason: z.string().optional(),
  executionMode: z.enum(["real", "mock"]),
  isDefault: z.boolean(),
  supportedRatios: z.array(z.string()),
  supportedResolutions: z.array(z.string()),
  supportedDurations: z.array(z.number().int()),
  maxOutputs: z.number().int(),
  supportsSeed: z.boolean(),
  referenceModes: z.array(z.string()),
  acceptedReferenceKinds: z.array(z.string()),
  pricing: z.object({ baseCredits: z.number().int(), perOutputCredits: z.number().int() }),
  dimensions: z
    .record(z.string(), z.record(z.string(), z.object({ width: z.number().int(), height: z.number().int() })))
    .optional(),
});
const creationCapabilitiesRoute = createRoute({
  method: "get",
  path: "/api/creation/capabilities",
  operationId: "getCreationCapabilities",
  responses: {
    200: {
      description: "AI creation composer model capabilities",
      content: { "application/json": { schema: z.object({ models: z.array(creationModelSchema) }) } },
    },
  },
});
app.openapi(creationCapabilitiesRoute, (c) => c.json({ models: creationCapabilities(videoModelEnabled) }, 200));

const libraryAssetResponse = (asset: MediaAsset) => ({
  id: asset.id,
  name: asset.displayName,
  originalName: asset.originalName,
  mimeType: asset.mimeType,
  size: asset.byteSize,
  width: asset.width,
  height: asset.height,
  durationSec: asset.durationSec,
  kind: asset.kind,
  description: asset.description,
  folderId: asset.folderId,
  url: `/api/assets/${asset.id}/content`,
  createdAt: asset.createdAt,
});

const directUploadInitRoute = createRoute({
  method: "post",
  path: "/api/uploads/direct",
  operationId: "createDirectUpload",
  request: {
    body: { required: true, content: { "application/json": { schema: DirectUploadRequestSchema } } },
  },
  responses: {
    200: {
      description: "Short-lived direct TOS upload authorization",
      content: { "application/json": { schema: DirectUploadInitSchema } },
    },
    400: { description: "Invalid upload", content: { "application/json": { schema: ErrorSchema } } },
    415: { description: "Unsupported media type", content: { "application/json": { schema: ErrorSchema } } },
    503: { description: "Direct upload unavailable", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(directUploadInitRoute, async (c) => {
  const requestId = crypto.randomUUID();
  if (!ossutils.configured)
    return c.json(
      {
        error: {
          code: "DIRECT_UPLOAD_UNAVAILABLE",
          message: "TOS 直传尚未配置",
          retryable: true,
          requestId,
        },
      },
      503,
    );
  const body = c.req.valid("json");
  const extension = directUploadExtensions[body.mimeType];
  if (!extension)
    return c.json(
      {
        error: {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "仅支持常见图片、视频和音频格式",
          retryable: false,
          requestId,
        },
      },
      415,
    );
  const folder = body.folderId
    ? accounts.getAssetFolder(c.get("userId"), body.folderId)
    : accounts.ensureDefaultAssetFolder(c.get("userId"));
  if (!folder)
    return c.json(
      {
        error: {
          code: "FOLDER_NOT_FOUND",
          message: "素材文件夹不存在",
          retryable: false,
          requestId,
        },
      },
      400,
    );
  const assetId = crypto.randomUUID();
  const storageKey = `${folder.storagePrefix}${assetId}${extension}`;
  const ticket = await issueDirectUploadTicket(
    {
      sub: c.get("userId"),
      assetId,
      storageKey,
      originalName: body.fileName,
      mimeType: body.mimeType,
      byteSize: body.size,
      width: body.width,
      height: body.height,
      durationSec: body.durationSec,
      kind: "media",
      displayName: body.displayName.trim() || body.fileName.replace(/\.[^.]+$/, "").slice(0, 80),
      description: body.description?.trim() || undefined,
      folderId: folder.id,
    },
    env.jwtSecret,
  );
  return c.json(
    {
      uploadUrl: ossutils.createSignedUploadUrl(storageKey),
      uploadToken: ticket.token,
      method: "PUT" as const,
      headers: { "Content-Type": body.mimeType },
      expiresAt: ticket.expiresAt,
    },
    200,
  );
});

const directUploadCompleteRoute = createRoute({
  method: "post",
  path: "/api/uploads/direct/complete",
  operationId: "completeDirectUpload",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ uploadToken: z.string().min(1) }) } },
    },
  },
  responses: {
    200: {
      description: "Previously completed upload",
      content: { "application/json": { schema: z.object({ asset: LibraryAssetSchema }) } },
    },
    201: {
      description: "Direct upload registered",
      content: { "application/json": { schema: z.object({ asset: LibraryAssetSchema }) } },
    },
    400: { description: "Invalid upload token", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Uploaded object does not match", content: { "application/json": { schema: ErrorSchema } } },
    502: { description: "TOS verification failed", content: { "application/json": { schema: ErrorSchema } } },
    503: { description: "Direct upload unavailable", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(directUploadCompleteRoute, async (c) => {
  const requestId = crypto.randomUUID();
  if (!ossutils.configured)
    return c.json(
      {
        error: {
          code: "DIRECT_UPLOAD_UNAVAILABLE",
          message: "TOS 直传尚未配置",
          retryable: true,
          requestId,
        },
      },
      503,
    );
  let ticket;
  try {
    ticket = await verifyDirectUploadTicket(c.req.valid("json").uploadToken, env.jwtSecret);
  } catch {
    return c.json(
      {
        error: {
          code: "INVALID_UPLOAD_TOKEN",
          message: "上传凭证无效或已过期，请重新上传",
          retryable: false,
          requestId,
        },
      },
      400,
    );
  }
  if (ticket.sub !== c.get("userId"))
    return c.json(
      {
        error: {
          code: "INVALID_UPLOAD_TOKEN",
          message: "上传凭证与当前账号不匹配",
          retryable: false,
          requestId,
        },
      },
      400,
    );
  const existing = accounts.getOwnedAsset(c.get("userId"), ticket.assetId);
  if (existing) return c.json({ asset: libraryAssetResponse(existing) }, 200);
  if (!accounts.getAssetFolder(c.get("userId"), ticket.folderId)) {
    await ossutils.deleteObject(ticket.storageKey).catch(() => undefined);
    return c.json(
      {
        error: {
          code: "FOLDER_NOT_FOUND",
          message: "素材文件夹已不存在，请重新选择",
          retryable: false,
          requestId,
        },
      },
      409,
    );
  }
  let metadata;
  try {
    metadata = (await ossutils.headObject(ticket.storageKey)).data;
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    return c.json(
      {
        error: {
          code: statusCode === 404 ? "DIRECT_UPLOAD_MISSING" : "DIRECT_UPLOAD_VERIFY_FAILED",
          message: statusCode === 404 ? "TOS 尚未收到完整文件，请重新上传" : "TOS 文件校验失败，请稍后重试",
          retryable: true,
          requestId,
        },
      },
      statusCode === 404 ? 409 : 502,
    );
  }
  const uploadedBytes = Number(metadata["content-length"] ?? 0);
  const uploadedMimeType = String(metadata["content-type"] ?? "").split(";", 1)[0];
  if (uploadedBytes !== ticket.byteSize || uploadedMimeType !== ticket.mimeType) {
    await ossutils.deleteObject(ticket.storageKey).catch(() => undefined);
    return c.json(
      {
        error: {
          code: "DIRECT_UPLOAD_MISMATCH",
          message: "TOS 文件信息与上传申请不一致，请重新上传",
          retryable: false,
          requestId,
        },
      },
      409,
    );
  }
  const asset: MediaAsset = {
    id: ticket.assetId,
    ownerUserId: ticket.sub,
    storageKey: ticket.storageKey,
    originalName: ticket.originalName,
    mimeType: ticket.mimeType,
    byteSize: ticket.byteSize,
    width: ticket.width,
    height: ticket.height,
    durationSec: ticket.durationSec,
    kind: ticket.kind,
    displayName: ticket.displayName,
    description: ticket.description,
    folderId: ticket.folderId,
    createdAt: new Date().toISOString(),
  };
  accounts.createAsset(asset);
  return c.json({ asset: libraryAssetResponse(asset) }, 201);
});

const uploadRoute = createRoute({
  method: "post",
  path: "/api/uploads",
  operationId: "uploadMedia",
  request: {
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.file().openapi({ type: "string", format: "binary" }),
            kind: AssetKindSchema.optional(),
            displayName: z.string().max(80).optional(),
            description: z.string().max(300).optional(),
            folderId: z.string().uuid().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Uploaded media",
      content: {
        "application/json": {
          schema: z.object({
            asset: z.object({
              id: z.string(),
              name: z.string(),
              mimeType: z.string(),
              size: z.number(),
              kind: AssetKindSchema,
              displayName: z.string(),
              description: z.string().optional(),
              folderId: z.string().uuid().optional(),
              url: z.string(),
              createdAt: z.string(),
            }),
          }),
        },
      },
    },
    400: { description: "Invalid upload", content: { "application/json": { schema: ErrorSchema } } },
    413: { description: "Upload too large", content: { "application/json": { schema: ErrorSchema } } },
    415: { description: "Unsupported media type", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(uploadRoute, async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  const rawKind = form.get("kind");
  const kind = AssetKindSchema.safeParse(rawKind || "media");
  const rawDisplayName = form.get("displayName");
  const rawDescription = form.get("description");
  const rawFolderId = form.get("folderId");
  const requestId = crypto.randomUUID();
  if (!(file instanceof File) || file.size === 0)
    return c.json({ error: { code: "INVALID_MEDIA", message: "请选择有效文件", retryable: false, requestId } }, 400);
  if (file.size > maxDirectUploadBytes)
    return c.json(
      { error: { code: "UPLOAD_TOO_LARGE", message: "文件不能超过 500MB", retryable: false, requestId } },
      413,
    );
  if (!directUploadExtensions[file.type])
    return c.json(
      {
        error: {
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "仅支持常见图片、视频和音频格式",
          retryable: false,
          requestId,
        },
      },
      415,
    );
  if (!kind.success)
    return c.json({ error: { code: "INVALID_ASSET_KIND", message: "资产分类无效", retryable: false, requestId } }, 400);
  if ((kind.data === "product" || kind.data === "portrait") && !file.type.startsWith("image/"))
    return c.json(
      { error: { code: "INVALID_ASSET_MEDIA", message: "商品和人像资产仅支持图片", retryable: false, requestId } },
      415,
    );
  if (kind.data === "voice" && !file.type.startsWith("audio/"))
    return c.json(
      { error: { code: "INVALID_ASSET_MEDIA", message: "音色资产仅支持音频", retryable: false, requestId } },
      415,
    );
  const id = crypto.randomUUID();
  const safeExtension =
    directUploadExtensions[file.type] ??
    extname(file.name)
      .replace(/[^.a-zA-Z0-9]/g, "")
      .slice(0, 10);
  const folder =
    kind.data === "media"
      ? typeof rawFolderId === "string" && rawFolderId
        ? accounts.getAssetFolder(c.get("userId"), rawFolderId)
        : accounts.ensureDefaultAssetFolder(c.get("userId"))
      : undefined;
  if (kind.data === "media" && !folder)
    return c.json(
      { error: { code: "FOLDER_NOT_FOUND", message: "素材文件夹不存在", retryable: false, requestId } },
      400,
    );
  const storageKey = folder ? `${folder.storagePrefix}${id}${safeExtension}` : `${id}${safeExtension}`;
  const displayName =
    typeof rawDisplayName === "string" && rawDisplayName.trim()
      ? rawDisplayName.trim().slice(0, 80)
      : file.name.replace(/\.[^.]+$/, "").slice(0, 80);
  const description =
    typeof rawDescription === "string" && rawDescription.trim() ? rawDescription.trim().slice(0, 300) : undefined;
  const createdAt = new Date().toISOString();
  const localPath = resolve(env.dataDir, "uploads", storageKey);
  mkdirSync(dirname(localPath), { recursive: true, mode: 0o700 });
  await Bun.write(localPath, file);
  if (folder && ossutils.configured)
    await ossutils.putLibraryFile({ filePath: localPath, key: storageKey, mimeType: file.type, sizeBytes: file.size });
  accounts.createAsset({
    id,
    ownerUserId: c.get("userId"),
    storageKey,
    originalName: file.name.slice(0, 200),
    mimeType: file.type,
    byteSize: file.size,
    kind: kind.data,
    displayName,
    description,
    folderId: folder?.id,
    createdAt,
  });
  return c.json(
    {
      asset: {
        id,
        name: file.name.slice(0, 200),
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        kind: kind.data,
        displayName,
        description,
        folderId: folder?.id,
        url: `/api/assets/${id}/content`,
        createdAt,
      },
    },
    201,
  );
});

const assetListRoute = createRoute({
  method: "get",
  path: "/api/assets",
  operationId: "listAssets",
  request: { query: z.object({ kind: AssetKindSchema.optional(), folderId: z.string().uuid().optional() }) },
  responses: {
    200: {
      description: "Current user's reusable assets",
      content: { "application/json": { schema: z.object({ assets: z.array(LibraryAssetSchema) }) } },
    },
  },
});

const productResponse = (product: ReturnType<AccountStore["listProducts"]>[number]) => ({
  id: product.id,
  name: product.name,
  description: product.description,
  sharingScope: product.sharingScope,
  createdAt: product.createdAt,
  images: product.images.map((asset) => ({
    id: asset.id,
    name: asset.displayName,
    originalName: asset.originalName,
    mimeType: asset.mimeType,
    size: asset.byteSize,
    kind: asset.kind,
    description: asset.description,
    url: `/api/assets/${asset.id}/content`,
    createdAt: asset.createdAt,
  })),
});

app.get("/api/products", (c) => c.json({ products: accounts.listProducts(c.get("userId")).map(productResponse) }, 200));

app.post("/api/products", async (c) => {
  const requestId = crypto.randomUUID();
  const form = await c.req.formData();
  const files = form.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
  const name = String(form.get("productName") ?? "")
    .trim()
    .slice(0, 200);
  const description = String(form.get("description") ?? "")
    .trim()
    .slice(0, 1_000);
  const sharingScope = String(form.get("sharingScope") ?? "private") as "private" | "team" | "organization";
  if (!name || !files.length || files.length > 8)
    return c.json(
      { error: { code: "INVALID_PRODUCT", message: "请填写商品名称并上传 1–8 张商品图", retryable: false, requestId } },
      400,
    );
  if (!(["private", "team", "organization"] as string[]).includes(sharingScope))
    return c.json(
      { error: { code: "INVALID_SHARING_SCOPE", message: "共享范围无效", retryable: false, requestId } },
      400,
    );
  const extensions: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };
  if (files.some((file) => !extensions[file.type] || file.size > 20 * 1024 * 1024))
    return c.json(
      {
        error: {
          code: "INVALID_PRODUCT_IMAGE",
          message: "商品图仅支持 PNG、JPG、WEBP，单张不超过 20MB",
          retryable: false,
          requestId,
        },
      },
      415,
    );
  const productId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const images = files.map((file) => ({
    id: crypto.randomUUID(),
    ownerUserId: c.get("userId"),
    storageKey: `${crypto.randomUUID()}${extensions[file.type]}`,
    originalName: file.name.slice(0, 200),
    mimeType: file.type,
    byteSize: file.size,
    kind: "product" as const,
    displayName: name,
    description: description || undefined,
    createdAt,
  }));
  await Promise.all(
    images.map((asset, index) => Bun.write(resolve(env.dataDir, "uploads", asset.storageKey), files[index])),
  );
  accounts.createProductAssets(
    {
      id: productId,
      ownerUserId: c.get("userId"),
      name,
      description: description || undefined,
      sharingScope,
      createdAt,
    },
    images,
  );
  const product = accounts.listProducts(c.get("userId")).find((item) => item.id === productId);
  if (!product)
    return c.json(
      { error: { code: "PRODUCT_CREATE_FAILED", message: "商品创建失败", retryable: true, requestId } },
      500,
    );
  return c.json({ product: productResponse(product) }, 201);
});

app.openapi(assetListRoute, (c) => {
  const { kind, folderId } = c.req.valid("query");
  const assets = accounts.listAssets(c.get("userId"), kind, folderId).map(libraryAssetResponse);
  return c.json({ assets }, 200);
});

const folderResponse = (folder: ReturnType<AccountStore["ensureDefaultAssetFolder"]>) => ({
  id: folder.id,
  parentId: folder.parentId,
  name: folder.name,
  storagePrefix: folder.storagePrefix,
  createdAt: folder.createdAt,
  updatedAt: folder.updatedAt,
});

app.get("/api/asset-folders", (c) =>
  c.json({ folders: accounts.listAssetFolders(c.get("userId")).map(folderResponse) }, 200),
);

app.post("/api/asset-folders", async (c) => {
  try {
    const body = (await c.req.json()) as { name?: string; parentId?: string };
    const folder = accounts.createAssetFolder(c.get("userId"), body.name ?? "", body.parentId);
    mkdirSync(resolve(env.dataDir, "uploads", folder.storagePrefix), { recursive: true, mode: 0o700 });
    if (ossutils.configured) await ossutils.ensureDirectory(folder.storagePrefix);
    return c.json({ folder: folderResponse(folder) }, 201);
  } catch (error) {
    if (error instanceof AccountError)
      return c.json(
        { error: { code: error.code, message: error.message, retryable: false, requestId: crypto.randomUUID() } },
        error.status,
      );
    throw error;
  }
});

app.patch("/api/asset-folders/:folderId", async (c) => {
  try {
    const body = (await c.req.json()) as { name?: string };
    const folder = accounts.renameAssetFolder(c.get("userId"), c.req.param("folderId"), body.name ?? "");
    return c.json({ folder: folderResponse(folder) }, 200);
  } catch (error) {
    if (error instanceof AccountError)
      return c.json(
        { error: { code: error.code, message: error.message, retryable: false, requestId: crypto.randomUUID() } },
        error.status,
      );
    throw error;
  }
});

app.delete("/api/asset-folders/:folderId", async (c) => {
  try {
    const folder = accounts.getAssetFolder(c.get("userId"), c.req.param("folderId"));
    accounts.deleteAssetFolder(c.get("userId"), c.req.param("folderId"));
    if (folder && ossutils.configured) await ossutils.deleteObject(folder.storagePrefix).catch(() => undefined);
    return c.body(null, 204);
  } catch (error) {
    if (error instanceof AccountError)
      return c.json(
        { error: { code: error.code, message: error.message, retryable: false, requestId: crypto.randomUUID() } },
        error.status,
      );
    throw error;
  }
});

const assetMetadataRoute = createRoute({
  method: "patch",
  path: "/api/assets/{assetId}/metadata",
  operationId: "saveAssetMetadata",
  request: {
    params: z.object({ assetId: z.string().uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            width: z.number().int().min(1).optional(),
            height: z.number().int().min(1).optional(),
            durationSec: z.number().min(0).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Asset metadata saved",
      content: { "application/json": { schema: z.object({ asset: LibraryAssetSchema }) } },
    },
    404: { description: "Asset not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(assetMetadataRoute, (c) => {
  const asset = accounts.updateAssetMetadata(c.get("userId"), c.req.valid("param").assetId, c.req.valid("json"));
  if (!asset)
    return c.json(
      {
        error: {
          code: "ASSET_NOT_FOUND",
          message: "素材不存在",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      404,
    );
  return c.json({ asset: libraryAssetResponse(asset) }, 200);
});

const assetContentRoute = createRoute({
  method: "get",
  path: "/api/assets/{assetId}/content",
  operationId: "getAssetContent",
  request: { params: z.object({ assetId: z.string().uuid() }) },
  responses: {
    200: {
      description: "Asset binary",
      content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } },
    },
    404: { description: "Not found", content: { "text/plain": { schema: z.string() } } },
  },
});
app.openapi(assetContentRoute, async (c) => {
  const asset = accounts.getOwnedAsset(c.get("userId"), c.req.valid("param").assetId);
  if (!asset) return new Response("Not found", { status: 404 });
  const file = Bun.file(resolve(env.dataDir, "uploads", asset.storageKey));
  if (!(await file.exists())) {
    if (!ossutils.configured) return new Response("Not found", { status: 404 });
    try {
      await ossutils.headObject(asset.storageKey);
      return Response.redirect(ossutils.createSignedReadUrl(asset.storageKey), 302);
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }
  return new Response(file, {
    headers: {
      "Content-Type": asset.mimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${asset.originalName.replaceAll('"', "")}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
});

const listRoute = createRoute({
  method: "get",
  path: "/api/jobs",
  operationId: "listJobs",
  request: { query: z.object({ moduleId: ModuleSchema.optional() }) },
  responses: {
    200: { description: "Jobs", content: { "application/json": { schema: z.object({ jobs: z.array(JobSchema) }) } } },
  },
});
app.openapi(listRoute, (c) =>
  c.json({ jobs: store.list(c.get("userId"), c.req.valid("query").moduleId as ModuleId | undefined) }, 200),
);

const remixFileSchema = z.object({
  id: z.union([z.number(), z.string()]).nullable().optional(),
  filename: z.string().min(1).max(200),
  objectKey: z.string().min(1),
  fileMd5: z.string().nullable().optional(),
  fileUrl: z.string().min(1),
  coverUrl: z.string().min(1),
  fileType: z.enum(["IMAGE", "VIDEO", "AUDIO"]),
  metaId: z.string().nullable().optional(),
  assetId: z.string().nullable().optional(),
  duration: z.number().nonnegative().nullable().optional(),
  durationSec: z.number().nonnegative().nullable().optional(),
  arkVideoUrl: z.string().nullable().optional(),
  aiDescription: z.string().nullable().optional(),
  reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
});
const remixProjectRequestSchema = z.object({
  projectName: z.string().trim().min(1).max(80),
  product: z.object({
    id: z.union([z.number(), z.string()]).nullable(),
    productName: z.string().min(1).max(200),
    productImages: z.array(remixFileSchema).min(1).max(20),
    productFormMetaList: z.array(z.unknown()).nullable().optional(),
    productFormDesc: z.string().nullable().optional(),
  }),
  demand: z.string().max(2_000).default(""),
  rawMaterialFiles: z.array(remixFileSchema).min(1).max(20),
  portraitAssets: z
    .array(
      z.object({
        id: z.union([z.number(), z.string()]).nullable().optional(),
        assetName: z.string().min(1).max(100),
        fileInfo: z.array(
          z.object({
            fileUrl: z.string().url(),
            coverUrl: z.string().url(),
            fileType: z.literal("IMAGE"),
            assetId: z.string().nullable().optional(),
          }),
        ),
        description: z.string().max(1_000).default(""),
        gender: z.string().max(20).default(""),
        age: z.number().int().min(0).max(150).nullable().optional(),
        occupation: z.string().max(100).default(""),
      }),
    )
    .max(10)
    .default([]),
});

app.post("/api/video-remix/project/generate", async (c) => {
  const requestId = crypto.randomUUID();
  const parsed = remixProjectRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json(
      { error: { code: "INVALID_REMIX_REQUEST", message: "爆款二创请求参数无效", retryable: false, requestId } },
      400,
    );
  if (!isModuleOpen("video-remix"))
    return c.json(
      { error: { code: "FEATURE_NOT_OPEN", message: "该功能正在验收，暂未开放", retryable: false, requestId } },
      403,
    );
  const ownerUserId = c.get("userId");
  const productAssetIds = parsed.data.product.productImages.map((file) => file.metaId).filter(Boolean) as string[];
  const videoAssetIds = parsed.data.rawMaterialFiles.map((file) => file.objectKey);
  const assets = [...productAssetIds, ...videoAssetIds].map((id) => accounts.getOwnedAsset(ownerUserId, id));
  if (!productAssetIds.length || assets.some((asset) => !asset))
    return c.json(
      { error: { code: "ASSET_NOT_AVAILABLE", message: "引用的商品或视频素材不存在", retryable: false, requestId } },
      422,
    );
  if (
    assets
      .slice(0, productAssetIds.length)
      .some((asset) => asset?.kind !== "product" || !asset.mimeType.startsWith("image/"))
  )
    return c.json(
      { error: { code: "INVALID_PRODUCT_ASSET", message: "商品素材必须是商品库图片", retryable: false, requestId } },
      422,
    );
  if (assets.slice(productAssetIds.length).some((asset) => !asset?.mimeType.startsWith("video/")))
    return c.json(
      { error: { code: "INVALID_VIDEO_ASSET", message: "分镜素材必须全部为视频", retryable: false, requestId } },
      422,
    );
  const productAsset = assets[0];
  const videoAsset = assets[productAssetIds.length];
  if (!productAsset || !videoAsset)
    return c.json(
      { error: { code: "ASSET_NOT_AVAILABLE", message: "引用的商品或视频素材不存在", retryable: false, requestId } },
      422,
    );
  const values = {
    workflowPhase: "analysis",
    source: `asset:${videoAsset.id}:${videoAsset.originalName}`,
    product: `asset:${productAsset.id}:${parsed.data.product.productName}`,
    productName: parsed.data.product.productName,
    productImageAssetIds: JSON.stringify(productAssetIds),
    description: parsed.data.demand,
    prompt: parsed.data.demand,
    portrait: parsed.data.portraitAssets[0]?.assetName ?? "",
    projectRequest: JSON.stringify(parsed.data),
  };
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim().slice(0, 128);
  if (idempotencyKey) {
    const existing = store.getByIdempotencyKey(ownerUserId, idempotencyKey);
    if (existing) return c.json(existing, 202);
  }
  const createdAt = new Date().toISOString();
  const id = crypto.randomUUID();
  const job: JobRecord = {
    id,
    ownerUserId,
    moduleId: "video-remix",
    title: parsed.data.projectName,
    status: "queued",
    progress: 0,
    stage: "排队中",
    overallExecutionMode: "real",
    values,
    executionPlan: [
      {
        id: "plan:0:media-probe",
        capability: "media-probe",
        executionMode: "local",
        implementation: "ffprobe-local",
        startedAt: "",
      },
      {
        id: "plan:1:speech-transcribe",
        capability: "speech-transcribe",
        executionMode: "real",
        implementation: "aihubmix-transcription",
        provider: "aihubmix",
        model: "gpt-4o-transcribe-diarize",
        startedAt: "",
      },
      {
        id: "plan:2:video-understand",
        capability: "video-understand",
        executionMode: "real",
        implementation: "gemini-video-analysis",
        provider: "aihubmix",
        model: env.videoAnalysisModel,
        startedAt: "",
      },
    ],
    provenance: [],
    idempotencyKey,
    cancelRequested: false,
    providerCancelState: "none",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt,
    updatedAt: createdAt,
  };
  store.create(job);
  queue.enqueue(id);
  return c.json(job, 202);
});

const createJobRoute = createRoute({
  method: "post",
  path: "/api/{moduleId}/jobs",
  operationId: "createJob",
  request: {
    params: z.object({ moduleId: ModuleSchema }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            title: z.string().min(1).max(200),
            values: z.record(z.string(), z.string()),
            videoModel: VideoModelIdSchema.optional(),
            allowMockFallback: z.boolean().default(true),
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    202: { description: "Accepted", content: { "application/json": { schema: JobSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorSchema } } },
    403: { description: "Feature not open", content: { "application/json": { schema: ErrorSchema } } },
    422: { description: "Invalid model or referenced asset", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(createJobRoute, (c) => {
  const moduleId = c.req.valid("param").moduleId as ModuleId;
  if (!isModuleOpen(moduleId))
    return c.json(
      {
        error: {
          code: "FEATURE_NOT_OPEN",
          message: "该功能正在验收，暂未开放",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      403,
    );
  const body = c.req.valid("json");
  const ownerUserId = c.get("userId");
  const needsVideoModel = moduleId === "video-remix" || (moduleId === "ai-generate" && body.values.type === "视频");
  let creationQuote = 0;
  if (moduleId === "ai-generate" && body.values.creationKind) {
    const models = creationCapabilities(videoModelEnabled);
    const validationError = validateCreationValues(body.values, models);
    if (validationError)
      return c.json(
        {
          error: {
            code: "INVALID_CREATION_CONFIG",
            message: validationError,
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        },
        422,
      );
    creationQuote = quoteCreation(body.values, models);
    const user = accounts.getUser(ownerUserId);
    if (!user || user.credits < creationQuote)
      return c.json(
        {
          error: {
            code: "INSUFFICIENT_CREDITS",
            message: `本次预计消耗 ${creationQuote} 创作点，当前余额不足`,
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        },
        422,
      );
    if (body.values.creationKind === "video" && body.videoModel !== body.values.modelId)
      return c.json(
        {
          error: {
            code: "INVALID_VIDEO_MODEL",
            message: "视频模型与创作配置不一致",
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        },
        422,
      );
  }
  if (needsVideoModel && !body.videoModel)
    return c.json(
      {
        error: {
          code: "INVALID_VIDEO_MODEL",
          message: "请选择 Seedance 视频模型",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      422,
    );
  if (body.videoModel && !videoModelEnabled(body.videoModel))
    return c.json(
      {
        error: {
          code: "VIDEO_MODEL_NOT_VERIFIED",
          message: "该 Seedance 模型尚未通过本轮真实基线验证",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      422,
    );
  if (!needsVideoModel && body.videoModel)
    return c.json(
      {
        error: {
          code: "INVALID_VIDEO_MODEL",
          message: "当前本地处理模式不使用视频生成模型",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      422,
    );
  const unavailableAsset = referencedAssetIds(body.values).find((id) => !accounts.ownsAsset(ownerUserId, id));
  if (unavailableAsset)
    return c.json(
      {
        error: {
          code: "ASSET_NOT_AVAILABLE",
          message: "引用的素材不存在或不属于当前账号",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      422,
    );
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim().slice(0, 128);
  if (idempotencyKey) {
    const existing = store.getByIdempotencyKey(ownerUserId, idempotencyKey);
    if (existing) return c.json(existing, 202);
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const executionPlan: StageProvenance[] = buildExecutionPlan(moduleId, body.values, body.videoModel);
  const job: JobRecord = {
    id,
    ownerUserId,
    moduleId,
    title: body.title,
    status: "queued",
    progress: 0,
    stage: "排队中",
    overallExecutionMode: "mock",
    values: body.values,
    videoModel: body.videoModel,
    executionPlan,
    provenance: [],
    idempotencyKey,
    cancelRequested: false,
    providerCancelState: "none",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt: now,
    updatedAt: now,
  };
  try {
    if (creationQuote > 0) store.createCharged(job, creationQuote);
    else store.create(job);
  } catch (error) {
    if (error instanceof InsufficientCreditsError)
      return c.json(
        {
          error: {
            code: "INSUFFICIENT_CREDITS",
            message: "创作点余额发生变化，请刷新后重试",
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        },
        422,
      );
    throw error;
  }
  queue.enqueue(id);
  return c.json(job, 202);
});

const getJobRoute = createRoute({
  method: "get",
  path: "/api/jobs/{jobId}",
  operationId: "getJob",
  request: { params: z.object({ jobId: z.string().uuid() }) },
  responses: {
    200: { description: "Job", content: { "application/json": { schema: JobSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(getJobRoute, (c) => {
  const job = store.getOwned(c.req.valid("param").jobId, c.get("userId"));
  return job
    ? c.json(job, 200)
    : c.json(
        { error: { code: "NOT_FOUND", message: "任务不存在", retryable: false, requestId: crypto.randomUUID() } },
        404,
      );
});

const cancelRoute = createRoute({
  method: "post",
  path: "/api/jobs/{jobId}/cancel",
  operationId: "cancelJob",
  request: { params: z.object({ jobId: z.string().uuid() }) },
  responses: {
    200: { description: "Cancelled", content: { "application/json": { schema: JobSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(cancelRoute, (c) => {
  const id = c.req.valid("param").jobId;
  const job = store.getOwned(id, c.get("userId"));
  if (!job)
    return c.json(
      { error: { code: "NOT_FOUND", message: "任务不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  if (job.status === "queued")
    return c.json(store.update(id, { status: "cancelled", cancelRequested: true, stage: "已取消" })!, 200);
  return c.json(store.update(id, { cancelRequested: true, stage: "正在取消" })!, 200);
});

const retryRoute = createRoute({
  method: "post",
  path: "/api/jobs/{jobId}/retry",
  operationId: "retryJob",
  request: { params: z.object({ jobId: z.string().uuid() }) },
  responses: {
    202: { description: "Retry accepted", content: { "application/json": { schema: JobSchema } } },
    403: { description: "Feature not open", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Retry blocked", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(retryRoute, (c) => {
  const source = store.getOwned(c.req.valid("param").jobId, c.get("userId"));
  if (!source)
    return c.json(
      { error: { code: "NOT_FOUND", message: "任务不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  if (!isModuleOpen(source.moduleId))
    return c.json(
      {
        error: {
          code: "FEATURE_NOT_OPEN",
          message: "该功能正在验收，暂未开放",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      403,
    );
  if (source.executionPlan.some((stage) => stage.model === "wan2.6-t2v"))
    return c.json(
      {
        error: {
          code: "MODEL_SELECTION_REQUIRED",
          message: "Wan 已停用，请返回配置页选择 Seedance 后创建新任务",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  if (
    source.providerTaskId &&
    !["completed", "succeeded", "failed", "cancelled", "expired"].includes(source.providerStatus ?? "")
  )
    return c.json(
      {
        error: {
          code: "UPSTREAM_STILL_RUNNING",
          message: "上游任务仍在运行或核对中，暂不能重复提交",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  const now = new Date().toISOString();
  const retry: JobRecord = {
    ...source,
    id: crypto.randomUUID(),
    title: `${source.title}（重试）`,
    status: "queued",
    progress: 0,
    stage: "排队中",
    provenance: [],
    result: undefined,
    error: undefined,
    parentJobId: source.id,
    idempotencyKey: undefined,
    cancelRequested: false,
    providerTaskId: undefined,
    providerStatus: undefined,
    providerSubmittedAt: undefined,
    providerDeadlineAt: undefined,
    providerCancelState: "none",
    stagingKeys: [],
    createdAt: now,
    updatedAt: now,
  };
  store.create(retry);
  queue.enqueue(retry.id);
  return c.json(retry, 202);
});

const eventsRoute = createRoute({
  method: "get",
  path: "/api/jobs/{jobId}/events",
  operationId: "watchJobEvents",
  request: { params: z.object({ jobId: z.string().uuid() }) },
  responses: {
    200: { description: "Server-sent job updates", content: { "text/event-stream": { schema: z.string() } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(eventsRoute, (c) => {
  const id = c.req.valid("param").jobId;
  if (!store.getOwned(id, c.get("userId")))
    return c.json(
      { error: { code: "NOT_FOUND", message: "任务不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  return streamSSE(c, async (stream) => {
    let eventId = 0;
    const send = async (job: JobRecord) => {
      eventId += 1;
      await stream.writeSSE({
        id: String(eventId),
        event:
          job.status === "succeeded" || job.status === "failed" || job.status === "cancelled"
            ? "job.completed"
            : "job.updated",
        data: JSON.stringify(job),
      });
    };
    await send(store.get(id)!);
    const unsubscribe = queue.subscribe(id, (job) => void send(job));
    while (!stream.aborted) {
      const job = store.get(id);
      if (!job || ["succeeded", "partially_succeeded", "failed", "cancelled"].includes(job.status)) break;
      await stream.sleep(1000);
    }
    unsubscribe();
  });
});

const artifactRoute = createRoute({
  method: "get",
  path: "/api/artifacts/{artifactId}",
  operationId: "downloadArtifact",
  request: { params: z.object({ artifactId: z.string().uuid() }) },
  responses: {
    200: {
      description: "Artifact binary",
      content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } },
    },
    404: { description: "Not found", content: { "text/plain": { schema: z.string() } } },
  },
});
app.openapi(artifactRoute, async (c) => {
  const artifact = accounts.getArtifact(c.get("userId"), c.req.valid("param").artifactId);
  if (!artifact) return new Response("Not found", { status: 404 });
  const file = Bun.file(resolve(env.dataDir, "results", artifact.storage_key));
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  return new Response(file, {
    headers: {
      "Content-Type": artifact.mime_type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${artifact.name.replaceAll('"', "")}"`,
    },
  });
});

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { title: `${APP_CONFIG.projectName} AI 创作 API`, version: "0.1.0" },
});

export { app };
