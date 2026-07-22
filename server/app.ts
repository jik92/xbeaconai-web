import { mkdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { MiddlewareHandler } from "hono";
import { parseVideoMashupConfig, type VideoMashupConfig } from "../shared/video-mashup/config";
import { APP_CONFIG, isModuleOpen } from "../web/app/config";
import type { ModuleId } from "../web/entities/types";
import {
  AccountError,
  AccountStore,
  type MediaAsset,
  type Preferences,
  rechargePackages,
} from "./accounts/account-store";
import { authenticate, issueToken } from "./accounts/auth";
import { createApplicationSmsSender } from "./accounts/configured-sms-sender";
import { SmsProviderError } from "./accounts/sms-sender";
import { AdScriptStore, AdScriptVersionConflictError } from "./ad-script/ad-script-store";
import { checkAdScriptCompliance } from "./ad-script/compliance";
import {
  AD_SCRIPT_CREDITS_PER_VARIANT,
  AD_SCRIPT_MODEL,
  AdScriptComplianceSchema,
  AdScriptInputSchema,
  AdScriptProjectStatusSchema,
  AdScriptScoreDetailSchema,
  AdScriptVariantStatusSchema,
  AdScriptVersionSourceSchema,
} from "./ad-script/types";
import {
  type ProviderCredentialName,
  providerCredentialNames,
  providerCredentials,
  providerIds,
} from "./byok/credential-store";
import { credentialDoctor } from "./byok/credential-doctor";
import { maxEnvKeyBytes, parseEnvKey } from "./byok/env-key";
import { allProviderFeatureAvailability, moduleFeatureAvailability } from "./byok/provider-feature-gate";
import { creationCapabilities, quoteCreation, validateCreationValues } from "./creation/capabilities";
import { env } from "./env";
import { platformAdapters, ShareContentParser } from "./imports/share-content";
import type { ShareCandidate } from "./imports/share-content";

const shareParser = new ShareContentParser(platformAdapters);
import { BullJobQueue } from "./jobs/bull-job-queue";
import { stopAllAdminJobs } from "./jobs/admin-job-control";
import { InsufficientCreditsError, SqliteJobStore } from "./jobs/sqlite-job-store";
import { seedanceModelIds, videoModels } from "./models/video-models";
import { getPortraitById } from "./portraits/catalog";
import { auditSdkRegistry } from "./sdk-registry";
import { ossutils } from "./storage/ossutils";
import { rollbackUploadedObjects, uploadFilesStrictly } from "./storage/strict-library-upload";
import type { JobModuleId, JobRecord } from "./types";
import {
  directUploadExtensions,
  issueDirectUploadTicket,
  maxDirectUploadBytes,
  verifyDirectUploadTicket,
} from "./uploads/direct-upload";
import { inlineUtf8ContentDisposition } from "./uploads/content-disposition";
import {
  VIDEO_CREATE_ANALYSIS_MODEL,
  VideoCreateInputSchema,
  VideoCreateProjectStatusSchema,
  VideoCreateRecommendationSchema,
  VideoCreateShotStatusSchema,
} from "./video-create/types";
import {
  nextVideoCreateStatus,
  VideoCreateStateError,
  VideoCreateStore,
  VideoCreateVersionConflictError,
  videoCreateJobValues,
} from "./video-create/video-create-store";
import { validateVoiceTaskValues } from "./voice/validate-voice-task";

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
  "video-extract",
  "video-editor",
  "kickart",
] as const;
const backgroundJobTypes = ["douyin-video-import", "share-content-import"] as const;
const jobModuleIds = [...moduleIds, ...backgroundJobTypes] as const;
const ModuleSchema = z.enum(moduleIds).openapi("ModuleId");
const JobModuleSchema = z.enum(jobModuleIds).openapi("JobModuleId");
const VideoModelIdSchema = z.enum(seedanceModelIds).openapi("SeedanceModelId");
const JobStatusSchema = z.enum(["queued", "processing", "succeeded", "partially_succeeded", "failed", "cancelled"]);
const ProviderCredentialNameSchema = z.enum(providerCredentialNames).openapi("ProviderCredentialName");
const ProviderIdSchema = z.enum(providerIds).openapi("ProviderId");
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
    moduleId: JobModuleSchema,
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
const AdScriptVersionSchema = z
  .object({
    id: z.string().uuid(),
    variantId: z.string().uuid(),
    sequence: z.number().int().min(1),
    source: AdScriptVersionSourceSchema,
    parentVersionId: z.string().uuid().nullable(),
    round: z.number().int().nonnegative(),
    script: z.string(),
    score: AdScriptScoreDetailSchema,
    compliance: AdScriptComplianceSchema,
    changeSummary: z.string(),
    model: z.string(),
    createdAt: z.string(),
  })
  .openapi("AdScriptVersion");
const AdScriptVariantSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    ordinal: z.number().int().min(1).max(3),
    status: AdScriptVariantStatusSchema,
    currentVersionId: z.string().uuid().nullable(),
    finalScore: z.number().int().min(0).max(100).nullable(),
    compliancePassed: z.boolean().nullable(),
    iterationCount: z.number().int().nonnegative(),
    error: ApiErrorSchema.nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    versions: z.array(AdScriptVersionSchema),
  })
  .openapi("AdScriptVariant");
const AdScriptProjectSchema = z
  .object({
    project: z.object({
      id: z.string().uuid(),
      ownerUserId: z.string().uuid(),
      jobId: z.string().uuid().nullable(),
      status: AdScriptProjectStatusSchema,
      input: AdScriptInputSchema,
      idempotencyKey: z.string().nullable(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
    variants: z.array(AdScriptVariantSchema),
  })
  .openapi("AdScriptProject");
const VideoCreateVersionSchema = z.object({
  id: z.string().uuid(),
  sectionId: z.string().uuid(),
  sequence: z.number().int().min(1),
  source: z.enum(["generated", "regenerated", "human"]),
  parentVersionId: z.string().uuid().nullable(),
  text: z.string(),
  durationSec: z.number().int().min(1),
  model: z.string(),
  createdAt: z.string(),
});
const VideoCreateSectionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  ordinal: z.number().int().min(1),
  label: z.string(),
  currentVersionId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  versions: z.array(VideoCreateVersionSchema),
  currentVersion: VideoCreateVersionSchema.optional(),
});
const VideoCreateShotSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  scriptSectionId: z.string().uuid(),
  ordinal: z.number().int().min(1),
  prompt: z.string(),
  durationSec: z.number().int().min(1),
  status: VideoCreateShotStatusSchema,
  jobId: z.string().uuid().nullable(),
  videoAssetId: z.string().uuid().nullable(),
  audioEnabled: z.boolean(),
  subtitleEnabled: z.boolean(),
  attempts: z.number().int().nonnegative(),
  error: ApiErrorSchema.nullish(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const VideoCreateProjectSchema = z
  .object({
    project: z.object({
      id: z.string().uuid(),
      ownerUserId: z.string().uuid(),
      title: z.string(),
      status: VideoCreateProjectStatusSchema,
      input: VideoCreateInputSchema,
      recommendation: VideoCreateRecommendationSchema.nullable(),
      currentJobId: z.string().uuid().nullable(),
      finalArtifactId: z.string().uuid().nullable(),
      version: z.number().int().min(1),
      idempotencyKey: z.string().nullable(),
      error: ApiErrorSchema.nullish(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
    sections: z.array(VideoCreateSectionSchema),
    shots: z.array(VideoCreateShotSchema),
    canCompose: z.boolean(),
  })
  .openapi("VideoCreateProject");
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
export const accounts = new AccountStore(env.databasePath, { smsSender: createApplicationSmsSender() });
export const adScripts = new AdScriptStore();
export const videoCreates = new VideoCreateStore();
export const queue = new BullJobQueue();
function adminUser(userId: string) {
  const user = accounts.getUser(userId);
  return Boolean(user?.isAdmin);
}
type AppEnv = { Variables: { userId: string; sessionId: string } };
const app = new OpenAPIHono<AppEnv>();
const publicApiPaths = new Set([
  "/api/health",
  "/api/capabilities",
  "/api/provider-features",
  "/api/models",
  "/api/creation/capabilities",
  "/api/auth/register",
  "/api/auth/sms-code",
  "/api/auth/password/verify",
  "/api/auth/password/setup",
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
  if (env.forceMock || env.mockGenerateVideoApi) return true;
  const sdk = auditSdkRegistry().find((item) => item.model === modelId && item.capability === "video-generate");
  return Boolean(sdk && getVerifiedSdkIds().has(sdk.id));
}

app.use(
  "/api/*",
  cors({
    origin: (origin) => (env.allowedOrigins.has(origin) ? origin : ""),
    allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "Last-Event-ID"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
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

function providerGuard(moduleId: ModuleId): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
    const availability = moduleFeatureAvailability(moduleId);
    if (availability.enabled) return next();
    return c.json(
      {
        error: {
          code: "PROVIDER_NOT_VERIFIED",
          message: availability.disabledReason ?? "相关 Provider 尚未检测通过",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      403,
    );
  };
}

app.use("/api/video-remix/*", providerGuard("video-remix"));
app.use("/api/ad-script/*", providerGuard("ad-script"));
app.use("/api/video-create/*", providerGuard("video-create"));
app.use("/api/uploads", providerGuard("video-cut"));
app.use("/api/uploads/direct*", providerGuard("video-cut"));
app.use("/api/products", providerGuard("video-cut"));
app.use("/api/imports/share-content*", providerGuard("video-cut"));

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
            queue: z.literal("bullmq"),
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
      queue: "bullmq" as const,
    },
    200,
  ),
);

const UserSchema = z
  .object({
    id: z.string().uuid(),
    phone: z.string().regex(/^1[3-9]\d{9}$/),
    displayName: z.string(),
    credits: z.number().int().nonnegative(),
    isAdmin: z.boolean(),
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
const PhoneSchema = z
  .string()
  .trim()
  .regex(/^1[3-9]\d{9}$/, "请输入有效的中国大陆手机号");
const VerificationCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "请输入 6 位数字验证码");
const SmsPurposeSchema = z.enum(["register", "reset_password"]);
const PasswordSetupChallengeSchema = z
  .object({ phone: PhoneSchema, setupToken: z.string().min(32), expiresAt: z.string() })
  .openapi("PasswordSetupChallenge");
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

const sendSmsCodeRoute = createRoute({
  method: "post",
  path: "/api/auth/sms-code",
  operationId: "sendSmsVerificationCode",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ phone: PhoneSchema, purpose: SmsPurposeSchema }) } },
    },
  },
  responses: {
    200: {
      description: "Verification code sent",
      content: {
        "application/json": {
          schema: z.object({
            expiresAt: z.string(),
            retryAfterSeconds: z.number().int().min(1),
            verificationCode: VerificationCodeSchema.optional(),
          }),
        },
      },
    },
    409: { description: "Phone exists", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Phone not registered", content: { "application/json": { schema: ErrorSchema } } },
    422: { description: "Invalid phone", content: { "application/json": { schema: ErrorSchema } } },
    429: { description: "Rate limited", content: { "application/json": { schema: ErrorSchema } } },
    503: { description: "SMS provider unavailable", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(sendSmsCodeRoute, async (c) => {
  const { phone, purpose } = c.req.valid("json");
  if (rateLimited(`sms:${purpose}:${c.req.header("x-forwarded-for") ?? "local"}`))
    return c.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "验证码请求过于频繁，请稍后再试",
          retryable: true,
          requestId: crypto.randomUUID(),
        },
      },
      429,
    );
  try {
    return c.json(await accounts.sendSmsCode(phone, purpose), 200);
  } catch (error) {
    if (error instanceof AccountError) {
      const body = {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.status === 429,
          requestId: crypto.randomUUID(),
        },
      };
      if (error.status === 409) return c.json(body, 409);
      if (error.status === 404) return c.json(body, 404);
      if (error.status === 429) return c.json(body, 429);
      return c.json(body, 422);
    }
    if (error instanceof SmsProviderError) {
      console.error("SMS provider request failed", { message: error.message, providerRequestId: error.requestId });
      return c.json(
        {
          error: {
            code: "SMS_PROVIDER_ERROR",
            message: "短信服务暂时不可用，请稍后重试",
            retryable: true,
            requestId: crypto.randomUUID(),
          },
        },
        503,
      );
    }
    throw error;
  }
});

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
            phone: PhoneSchema,
            verificationCode: VerificationCodeSchema,
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Registered and waiting for password setup",
      content: { "application/json": { schema: PasswordSetupChallengeSchema } },
    },
    409: { description: "Phone exists", content: { "application/json": { schema: ErrorSchema } } },
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
    const materialFolder = accounts.ensureDefaultAssetFolder(registration.userId);
    mkdirSync(resolve(env.dataDir, "uploads", materialFolder.storagePrefix), { recursive: true, mode: 0o700 });
    if (ossutils.configured)
      await Promise.all([
        ossutils.ensureDirectory(`${registration.userId}/`),
        ossutils.ensureDirectory(materialFolder.storagePrefix),
      ]).catch((error) => console.error("Failed to initialize user TOS directories", error));
    if (registration.claimedLegacy)
      await Promise.all(
        store
          .recoverable()
          .filter((job) => job.ownerUserId === registration.userId)
          .map((job) => queue.enqueue(job.id)),
      );
    return c.json(
      { phone: registration.phone, setupToken: registration.setupToken, expiresAt: registration.expiresAt },
      201,
    );
  } catch (error) {
    if (error instanceof AccountError) {
      const body = {
        error: { code: error.code, message: error.message, retryable: false, requestId: crypto.randomUUID() },
      };
      if (error.status === 409) return c.json(body, 409);
      if (error.status === 429) return c.json(body, 429);
      return c.json(body, 422);
    }
    throw error;
  }
});

const verifyPasswordResetRoute = createRoute({
  method: "post",
  path: "/api/auth/password/verify",
  operationId: "verifyPasswordReset",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ phone: PhoneSchema, verificationCode: VerificationCodeSchema }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Phone verified for password reset",
      content: { "application/json": { schema: PasswordSetupChallengeSchema } },
    },
    404: { description: "Phone not registered", content: { "application/json": { schema: ErrorSchema } } },
    422: { description: "Verification failed", content: { "application/json": { schema: ErrorSchema } } },
    429: { description: "Rate limited", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(verifyPasswordResetRoute, async (c) => {
  if (rateLimited(`password-reset:${c.req.header("x-forwarded-for") ?? "local"}`))
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
    return c.json(await accounts.verifyPasswordReset(c.req.valid("json")), 200);
  } catch (error) {
    if (error instanceof AccountError) {
      const body = {
        error: { code: error.code, message: error.message, retryable: false, requestId: crypto.randomUUID() },
      };
      if (error.status === 404) return c.json(body, 404);
      return c.json(body, 422);
    }
    throw error;
  }
});

const setupPasswordRoute = createRoute({
  method: "post",
  path: "/api/auth/password/setup",
  operationId: "setupPassword",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ setupToken: z.string().min(32).max(256), password: PasswordSchema }) },
      },
    },
  },
  responses: {
    200: { description: "Password set and logged in", content: { "application/json": { schema: AuthSchema } } },
    404: { description: "User not found", content: { "application/json": { schema: ErrorSchema } } },
    422: { description: "Invalid setup token", content: { "application/json": { schema: ErrorSchema } } },
    429: { description: "Rate limited", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(setupPasswordRoute, async (c) => {
  if (rateLimited(`password-setup:${c.req.header("x-forwarded-for") ?? "local"}`))
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
    const body = c.req.valid("json");
    return c.json(await issueToken(accounts, await accounts.setupPassword(body.setupToken, body.password)), 200);
  } catch (error) {
    if (error instanceof AccountError) {
      const body = {
        error: { code: error.code, message: error.message, retryable: false, requestId: crypto.randomUUID() },
      };
      if (error.status === 404) return c.json(body, 404);
      return c.json(body, 422);
    }
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
        "application/json": { schema: z.object({ phone: PhoneSchema, password: z.string().min(1).max(128) }) },
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
      user = await accounts.verifyCredentials(body.phone, body.password);
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
            displayName: z.string().trim().min(2).max(40),
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
  },
});
app.openapi(profileRoute, (c) => {
  return c.json({ user: accounts.updateProfile(c.get("userId"), c.req.valid("json")) }, 200);
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

const FeatureAvailabilitySchema = z.object({
  enabled: z.boolean(),
  requiredProviders: z.array(ProviderIdSchema),
  unavailableProviders: z.array(ProviderIdSchema),
  disabledReason: z.string().optional(),
});
const providerFeaturesRoute = createRoute({
  method: "get",
  path: "/api/provider-features",
  operationId: "getProviderFeatures",
  responses: {
    200: {
      description: "Provider-gated feature availability",
      content: {
        "application/json": {
          schema: z.object({
            modules: z.record(ModuleSchema, FeatureAvailabilitySchema),
            operations: z.object({
              assetUpload: FeatureAvailabilitySchema,
              shareImport: FeatureAvailabilitySchema,
            }),
          }),
        },
      },
    },
  },
});
app.openapi(providerFeaturesRoute, (c) => c.json(allProviderFeatureAvailability(), 200));

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
app.openapi(creationCapabilitiesRoute, (c) =>
  c.json({ models: creationCapabilities(videoModelEnabled, env.mockGenerateVideoApi ? "mock" : "real") }, 200),
);

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

async function removeAssetFiles(assets: MediaAsset[]) {
  const uploadRoot = resolve(env.dataDir, "uploads");
  await Promise.allSettled(
    assets.map(async (asset) => {
      const localPath = resolve(uploadRoot, asset.storageKey);
      const relativePath = relative(uploadRoot, localPath);
      if (!relativePath.startsWith("..") && !isAbsolute(relativePath)) await rm(localPath, { force: true });
      if (ossutils.configured) await ossutils.deleteObject(asset.storageKey);
    }),
  );
}

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
  const userId = c.get("userId");
  const folder = body.folderId
    ? accounts.getAssetFolder(userId, body.folderId)
    : accounts.getAssetFolder(userId, accounts.getDefaultAssetFolderId(userId));
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
  const userId = c.get("userId");
  const folder =
    kind.data === "media"
      ? typeof rawFolderId === "string" && rawFolderId
        ? accounts.getAssetFolder(userId, rawFolderId)
        : accounts.getAssetFolder(userId, accounts.getDefaultAssetFolderId(userId))
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
  const ownerUserId = c.get("userId");
  const createdAt = new Date().toISOString();
  const images = files.map((file) => {
    const id = crypto.randomUUID();
    return {
      id,
      ownerUserId,
      storageKey: `${ownerUserId}/products/${productId}/${id}${extensions[file.type]}`,
      originalName: file.name.slice(0, 200),
      mimeType: file.type,
      byteSize: file.size,
      kind: "product" as const,
      displayName: name,
      description: description || undefined,
      createdAt,
    };
  });
  if (!ossutils.configured)
    return c.json(
      { error: { code: "TOS_NOT_CONFIGURED", message: "TOS 未配置，商品图片无法上传", retryable: false, requestId } },
      503,
    );
  const uploadedKeys: string[] = [];
  try {
    uploadedKeys.push(
      ...(await uploadFilesStrictly(
        images.map((asset, index) => ({
          file: files[index],
          localPath: resolve(env.dataDir, "uploads", asset.storageKey),
          storageKey: asset.storageKey,
          mimeType: asset.mimeType,
          sizeBytes: asset.byteSize,
        })),
        {
          writeLocal: async (item) => {
            mkdirSync(dirname(item.localPath), { recursive: true, mode: 0o700 });
            await Bun.write(item.localPath, item.file);
          },
          uploadObject: (item) =>
            ossutils.putLibraryFile({
              filePath: item.localPath,
              key: item.storageKey,
              mimeType: item.mimeType,
              sizeBytes: item.sizeBytes,
            }),
          removeLocal: (path) => rm(path, { force: true }),
          deleteObject: (key) => ossutils.deleteObject(key),
        },
      )),
    );
  } catch {
    return c.json(
      { error: { code: "PRODUCT_UPLOAD_FAILED", message: "商品图片上传 TOS 失败", retryable: true, requestId } },
      502,
    );
  }
  try {
    accounts.createProductAssets(
      {
        id: productId,
        ownerUserId,
        name,
        description: description || undefined,
        sharingScope,
        createdAt,
      },
      images,
    );
  } catch {
    await rollbackUploadedObjects(uploadedKeys, (key) => ossutils.deleteObject(key));
    return c.json(
      { error: { code: "PRODUCT_CREATE_FAILED", message: "商品创建失败", retryable: true, requestId } },
      500,
    );
  }
  const product = accounts.listProducts(ownerUserId).find((item) => item.id === productId);
  if (!product) {
    try {
      accounts.deleteProduct(ownerUserId, productId);
    } catch {
      // The product lookup already failed; remote cleanup still takes priority.
    }
    await rollbackUploadedObjects(uploadedKeys, (key) => ossutils.deleteObject(key));
    return c.json(
      { error: { code: "PRODUCT_CREATE_FAILED", message: "商品创建失败", retryable: true, requestId } },
      500,
    );
  }
  return c.json({ product: productResponse(product) }, 201);
});

app.openapi(assetListRoute, (c) => {
  const { kind, folderId } = c.req.valid("query");
  const assets = accounts.listAssets(c.get("userId"), kind, folderId).map(libraryAssetResponse);
  return c.json({ assets }, 200);
});

const deleteAssetRoute = createRoute({
  method: "delete",
  path: "/api/assets/{assetId}",
  operationId: "deleteAsset",
  request: { params: z.object({ assetId: z.string().uuid() }) },
  responses: {
    204: { description: "Asset deleted" },
    404: { description: "Asset not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Delete the complete product", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteAssetRoute, async (c) => {
  try {
    const asset = accounts.deleteOwnedAsset(c.get("userId"), c.req.valid("param").assetId);
    await removeAssetFiles([asset]);
    return c.body(null, 204);
  } catch (error) {
    if (error instanceof AccountError)
      return c.json(
        { error: { code: error.code, message: error.message, retryable: false, requestId: crypto.randomUUID() } },
        error.status === 409 ? 409 : 404,
      );
    throw error;
  }
});

const deleteProductRoute = createRoute({
  method: "delete",
  path: "/api/products/{productId}",
  operationId: "deleteProduct",
  request: { params: z.object({ productId: z.string().uuid() }) },
  responses: {
    204: { description: "Product and its images deleted" },
    404: { description: "Product not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteProductRoute, async (c) => {
  try {
    const assets = accounts.deleteProduct(c.get("userId"), c.req.valid("param").productId);
    await removeAssetFiles(assets);
    return c.body(null, 204);
  } catch (error) {
    if (error instanceof AccountError)
      return c.json(
        { error: { code: error.code, message: error.message, retryable: false, requestId: crypto.randomUUID() } },
        404,
      );
    throw error;
  }
});

const folderResponse = (folder: ReturnType<AccountStore["ensureDefaultAssetFolder"]>, defaultFolderId?: string) => ({
  id: folder.id,
  parentId: folder.parentId,
  name: folder.name,
  storagePrefix: folder.storagePrefix,
  createdAt: folder.createdAt,
  updatedAt: folder.updatedAt,
  isDefault: folder.id === defaultFolderId,
});

app.get("/api/asset-folders", (c) => {
  const userId = c.get("userId");
  const defaultFolderId = accounts.getDefaultAssetFolderId(userId);
  return c.json(
    { folders: accounts.listAssetFolders(userId).map((folder) => folderResponse(folder, defaultFolderId)) },
    200,
  );
});

app.put("/api/asset-folders/:folderId/default", (c) => {
  try {
    const folder = accounts.setDefaultAssetFolder(c.get("userId"), c.req.param("folderId"));
    return c.json({ folder: folderResponse(folder, folder.id) }, 200);
  } catch (error) {
    if (error instanceof AccountError)
      return c.json(
        { error: { code: error.code, message: error.message, retryable: false, requestId: crypto.randomUUID() } },
        error.status,
      );
    throw error;
  }
});

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
      "Content-Disposition": inlineUtf8ContentDisposition(asset.originalName),
      "Cache-Control": "private, max-age=300",
    },
  });
});

const AdminCredentialSchema = z.object({
  name: ProviderCredentialNameSchema,
  providerId: ProviderIdSchema,
  provider: z.string(),
  label: z.string(),
  secret: z.boolean(),
  configured: z.boolean(),
  maskedValue: z.string().optional(),
  updatedAt: z.string().optional(),
});
const AdminJobSchema = JobSchema.extend({ ownerPhone: z.string() });
const AdminEnvKeyImportSchema = z.object({
  updated: z.array(ProviderCredentialNameSchema),
  skipped: z.array(ProviderCredentialNameSchema),
  ignored: z.array(z.string()),
});
const CredentialDoctorResultSchema = z.object({
  providerId: ProviderIdSchema,
  provider: z.string(),
  status: z.enum(["available", "missing", "invalid", "timeout"]),
  message: z.string(),
  latencyMs: z.number().int().nonnegative(),
  checkedAt: z.string(),
});
const StopAllAdminJobsResultSchema = z.object({
  matched: z.number().int().nonnegative(),
  queuedCancelled: z.number().int().nonnegative(),
  processingRequested: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
const AdminUserSchema = UserSchema.extend({
  status: z.enum(["pending_password", "active", "disabled"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const AdminCreditGrantSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  adminUserId: z.string().uuid(),
  credits: z.number().int().min(1),
  balanceAfter: z.number().int().nonnegative(),
  createdAt: z.string(),
});
const adminCredentialsRoute = createRoute({
  method: "get",
  path: "/api/admin/credentials",
  operationId: "listAdminCredentials",
  responses: {
    200: {
      description: "Masked provider credentials",
      content: { "application/json": { schema: z.object({ credentials: z.array(AdminCredentialSchema) }) } },
    },
    403: { description: "Admin required", content: { "application/json": { schema: ErrorSchema } } },
    503: { description: "BYOK unavailable", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(adminCredentialsRoute, (c) => {
  if (!adminUser(c.get("userId")))
    return c.json(
      {
        error: { code: "ADMIN_REQUIRED", message: "仅管理员可访问", retryable: false, requestId: crypto.randomUUID() },
      },
      403,
    );
  if (!providerCredentials.available)
    return c.json(
      {
        error: {
          code: "BYOK_UNAVAILABLE",
          message: "BYOK_ENCRYPTION_KEY 未配置",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      503,
    );
  return c.json({ credentials: providerCredentials.listMasked() }, 200);
});

const updateAdminCredentialRoute = createRoute({
  method: "put",
  path: "/api/admin/credentials/{name}",
  operationId: "updateAdminCredential",
  request: {
    params: z.object({ name: ProviderCredentialNameSchema }),
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ value: z.string().trim().min(1).max(4_096) }) } },
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: AdminCredentialSchema } } },
    403: { description: "Admin required", content: { "application/json": { schema: ErrorSchema } } },
    503: { description: "BYOK unavailable", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(updateAdminCredentialRoute, (c) => {
  if (!adminUser(c.get("userId")))
    return c.json(
      {
        error: { code: "ADMIN_REQUIRED", message: "仅管理员可访问", retryable: false, requestId: crypto.randomUUID() },
      },
      403,
    );
  if (!providerCredentials.available)
    return c.json(
      {
        error: {
          code: "BYOK_UNAVAILABLE",
          message: "BYOK_ENCRYPTION_KEY 未配置",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      503,
    );
  const name = c.req.valid("param").name as ProviderCredentialName;
  providerCredentials.set(name, c.req.valid("json").value, c.get("userId"));
  const credential = providerCredentials.listMasked().find((item) => item.name === name);
  if (!credential) throw new Error("CREDENTIAL_UPDATE_FAILED");
  return c.json(credential, 200);
});

const deleteAdminCredentialRoute = createRoute({
  method: "delete",
  path: "/api/admin/credentials/{name}",
  operationId: "deleteAdminCredential",
  request: { params: z.object({ name: ProviderCredentialNameSchema }) },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: AdminCredentialSchema } } },
    403: { description: "Admin required", content: { "application/json": { schema: ErrorSchema } } },
    503: { description: "BYOK unavailable", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(deleteAdminCredentialRoute, (c) => {
  if (!adminUser(c.get("userId")))
    return c.json(
      {
        error: { code: "ADMIN_REQUIRED", message: "仅管理员可访问", retryable: false, requestId: crypto.randomUUID() },
      },
      403,
    );
  if (!providerCredentials.available)
    return c.json(
      {
        error: {
          code: "BYOK_UNAVAILABLE",
          message: "BYOK_ENCRYPTION_KEY 未配置",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      503,
    );
  const name = c.req.valid("param").name as ProviderCredentialName;
  providerCredentials.delete(name);
  const credential = providerCredentials.listMasked().find((item) => item.name === name);
  if (!credential) throw new Error("CREDENTIAL_DELETE_FAILED");
  return c.json(credential, 200);
});

const importAdminEnvKeyRoute = createRoute({
  method: "post",
  path: "/api/admin/credentials/import",
  operationId: "importAdminEnvKey",
  request: {
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: z.object({ file: z.file().openapi({ type: "string", format: "binary" }) }),
        },
      },
    },
  },
  responses: {
    200: { description: "Imported", content: { "application/json": { schema: AdminEnvKeyImportSchema } } },
    400: { description: "Invalid env key file", content: { "application/json": { schema: ErrorSchema } } },
    403: { description: "Admin required", content: { "application/json": { schema: ErrorSchema } } },
    413: { description: "File too large", content: { "application/json": { schema: ErrorSchema } } },
    415: { description: "Unsupported file", content: { "application/json": { schema: ErrorSchema } } },
    503: { description: "BYOK unavailable", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(importAdminEnvKeyRoute, async (c) => {
  const requestId = crypto.randomUUID();
  if (!adminUser(c.get("userId")))
    return c.json({ error: { code: "ADMIN_REQUIRED", message: "仅管理员可访问", retryable: false, requestId } }, 403);
  if (!providerCredentials.available)
    return c.json(
      {
        error: {
          code: "BYOK_UNAVAILABLE",
          message: "BYOK_ENCRYPTION_KEY 未配置",
          retryable: false,
          requestId,
        },
      },
      503,
    );
  const file = (await c.req.formData()).get("file");
  if (!(file instanceof File) || !file.size)
    return c.json(
      { error: { code: "INVALID_ENV_KEY", message: "请选择有效的 .env.key 文件", retryable: false, requestId } },
      400,
    );
  if (file.name !== ".env.key")
    return c.json(
      { error: { code: "INVALID_ENV_KEY_NAME", message: "文件名必须是 .env.key", retryable: false, requestId } },
      415,
    );
  if (file.size > maxEnvKeyBytes)
    return c.json(
      { error: { code: "ENV_KEY_TOO_LARGE", message: ".env.key 不能超过 64KB", retryable: false, requestId } },
      413,
    );
  try {
    const parsed = parseEnvKey(await file.text());
    const updated = providerCredentials.setMany(parsed.values, c.get("userId"));
    const updatedSet = new Set(updated);
    return c.json(
      {
        updated,
        skipped: providerCredentialNames.filter((name) => !updatedSet.has(name)),
        ignored: parsed.ignored,
      },
      200,
    );
  } catch (error) {
    return c.json(
      {
        error: {
          code: "INVALID_ENV_KEY_CONTENT",
          message: error instanceof Error ? error.message : ".env.key 内容无效",
          retryable: false,
          requestId,
        },
      },
      400,
    );
  }
});

const adminCredentialDoctorRoute = createRoute({
  method: "post",
  path: "/api/admin/credentials/doctor",
  operationId: "runAdminCredentialDoctor",
  responses: {
    200: {
      description: "Provider credential doctor results",
      content: { "application/json": { schema: z.object({ results: z.array(CredentialDoctorResultSchema) }) } },
    },
    403: { description: "Admin required", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(adminCredentialDoctorRoute, async (c) => {
  if (!adminUser(c.get("userId")))
    return c.json(
      {
        error: { code: "ADMIN_REQUIRED", message: "仅管理员可访问", retryable: false, requestId: crypto.randomUUID() },
      },
      403,
    );
  return c.json({ results: await credentialDoctor.runAll() }, 200);
});

const adminCredentialDoctorResultsRoute = createRoute({
  method: "get",
  path: "/api/admin/credentials/doctor",
  operationId: "getAdminCredentialDoctorResults",
  responses: {
    200: {
      description: "Persisted provider credential doctor results",
      content: { "application/json": { schema: z.object({ results: z.array(CredentialDoctorResultSchema) }) } },
    },
    403: { description: "Admin required", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(adminCredentialDoctorResultsRoute, (c) => {
  if (!adminUser(c.get("userId")))
    return c.json(
      {
        error: { code: "ADMIN_REQUIRED", message: "仅管理员可访问", retryable: false, requestId: crypto.randomUUID() },
      },
      403,
    );
  return c.json({ results: providerCredentials.listChecks() }, 200);
});

const listAdminUsersRoute = createRoute({
  method: "get",
  path: "/api/admin/users",
  operationId: "listAdminUsers",
  request: {
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(10).max(100).default(25),
      query: z.string().trim().max(80).optional(),
      status: z.enum(["pending_password", "active", "disabled"]).optional(),
    }),
  },
  responses: {
    200: {
      description: "Admin user list",
      content: {
        "application/json": {
          schema: z.object({
            users: z.array(AdminUserSchema),
            total: z.number().int().nonnegative(),
            page: z.number().int().min(1),
            pageSize: z.number().int().min(1),
          }),
        },
      },
    },
    403: { description: "Admin required", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(listAdminUsersRoute, (c) => {
  if (!adminUser(c.get("userId")))
    return c.json(
      {
        error: { code: "ADMIN_REQUIRED", message: "仅管理员可访问", retryable: false, requestId: crypto.randomUUID() },
      },
      403,
    );
  return c.json(accounts.listAdminUsers(c.req.valid("query")), 200);
});

const grantAdminUserCreditsRoute = createRoute({
  method: "post",
  path: "/api/admin/users/{userId}/credits",
  operationId: "grantAdminUserCredits",
  request: {
    params: z.object({ userId: z.string().uuid() }),
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ credits: z.number().int().min(1).max(1_000_000_000) }) } },
    },
  },
  responses: {
    201: {
      description: "Credits granted",
      content: { "application/json": { schema: z.object({ grant: AdminCreditGrantSchema, user: AdminUserSchema }) } },
    },
    400: { description: "Missing idempotency key", content: { "application/json": { schema: ErrorSchema } } },
    403: { description: "Admin required", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "User not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Conflict", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(grantAdminUserCreditsRoute, (c) => {
  const requestId = crypto.randomUUID();
  if (!adminUser(c.get("userId")))
    return c.json({ error: { code: "ADMIN_REQUIRED", message: "仅管理员可访问", retryable: false, requestId } }, 403);
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim().slice(0, 128);
  if (!idempotencyKey)
    return c.json(
      { error: { code: "IDEMPOTENCY_KEY_REQUIRED", message: "缺少幂等键", retryable: false, requestId } },
      400,
    );
  try {
    const grant = accounts.grantAdminCredits({
      userId: c.req.valid("param").userId,
      adminUserId: c.get("userId"),
      credits: c.req.valid("json").credits,
      idempotencyKey,
    });
    const user = accounts.getAdminUser(grant.userId);
    if (!user) throw new AccountError("USER_NOT_FOUND", "账号不存在", 404);
    return c.json({ grant, user }, 201);
  } catch (error) {
    if (error instanceof AccountError && error.status === 404)
      return c.json({ error: { code: error.code, message: error.message, retryable: false, requestId } }, 404);
    if (error instanceof AccountError)
      return c.json({ error: { code: error.code, message: error.message, retryable: false, requestId } }, 409);
    throw error;
  }
});

const updateAdminUserStatusRoute = createRoute({
  method: "patch",
  path: "/api/admin/users/{userId}/status",
  operationId: "updateAdminUserStatus",
  request: {
    params: z.object({ userId: z.string().uuid() }),
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ status: z.enum(["active", "disabled"]) }) } },
    },
  },
  responses: {
    200: { description: "User status updated", content: { "application/json": { schema: AdminUserSchema } } },
    403: { description: "Admin required", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "User not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Status conflict", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(updateAdminUserStatusRoute, (c) => {
  const requestId = crypto.randomUUID();
  if (!adminUser(c.get("userId")))
    return c.json({ error: { code: "ADMIN_REQUIRED", message: "仅管理员可访问", retryable: false, requestId } }, 403);
  try {
    return c.json(
      accounts.setAdminUserStatus({
        userId: c.req.valid("param").userId,
        adminUserId: c.get("userId"),
        status: c.req.valid("json").status,
      }),
      200,
    );
  } catch (error) {
    if (error instanceof AccountError && error.status === 404)
      return c.json({ error: { code: error.code, message: error.message, retryable: false, requestId } }, 404);
    if (error instanceof AccountError)
      return c.json({ error: { code: error.code, message: error.message, retryable: false, requestId } }, 409);
    throw error;
  }
});

const listAdminJobsRoute = createRoute({
  method: "get",
  path: "/api/admin/jobs",
  operationId: "listAdminJobs",
  request: {
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(10).max(100).default(25),
      moduleId: ModuleSchema.optional(),
      status: JobStatusSchema.optional(),
      phone: z.string().trim().max(32).optional(),
    }),
  },
  responses: {
    200: {
      description: "All queue jobs",
      content: {
        "application/json": {
          schema: z.object({
            jobs: z.array(AdminJobSchema),
            total: z.number().int(),
            page: z.number().int(),
            pageSize: z.number().int(),
          }),
        },
      },
    },
    403: { description: "Admin required", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(listAdminJobsRoute, (c) => {
  if (!adminUser(c.get("userId")))
    return c.json(
      {
        error: { code: "ADMIN_REQUIRED", message: "仅管理员可访问", retryable: false, requestId: crypto.randomUUID() },
      },
      403,
    );
  return c.json(store.listAll(c.req.valid("query")), 200);
});

function cancelQueuedAdScript(job: JobRecord) {
  if (job.moduleId !== "ad-script") return;
  const aggregate = adScripts.getByJobId(job.id);
  if (!aggregate) return;
  adScripts.updateProject(aggregate.project.id, { status: "cancelled" });
  for (const variant of aggregate.variants)
    if (variant.status === "queued") adScripts.updateVariant(variant.id, { status: "cancelled" });
}

const stopAllAdminJobsRoute = createRoute({
  method: "post",
  path: "/api/admin/jobs/stop-all",
  operationId: "stopAllAdminJobs",
  responses: {
    200: {
      description: "All queued jobs cancelled and active jobs requested to cancel",
      content: { "application/json": { schema: StopAllAdminJobsResultSchema } },
    },
    403: { description: "Admin required", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(stopAllAdminJobsRoute, async (c) => {
  if (!adminUser(c.get("userId")))
    return c.json(
      {
        error: { code: "ADMIN_REQUIRED", message: "仅管理员可访问", retryable: false, requestId: crypto.randomUUID() },
      },
      403,
    );
  return c.json(await stopAllAdminJobs(store, queue, cancelQueuedAdScript), 200);
});

const listRoute = createRoute({
  method: "get",
  path: "/api/jobs",
  operationId: "listJobs",
  request: { query: z.object({ moduleId: JobModuleSchema.optional() }) },
  responses: {
    200: { description: "Jobs", content: { "application/json": { schema: z.object({ jobs: z.array(JobSchema) }) } } },
  },
});
app.openapi(listRoute, (c) =>
  c.json({ jobs: store.list(c.get("userId"), c.req.valid("query").moduleId as JobModuleId | undefined) }, 200),
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
  await queue.enqueue(id);
  return c.json(job, 202);
});

function adScriptJobRecord(input: {
  ownerUserId: string;
  title: string;
  values: Record<string, string>;
  idempotencyKey?: string;
  parentJobId?: string;
}): JobRecord {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    ownerUserId: input.ownerUserId,
    moduleId: "ad-script",
    title: input.title,
    status: "queued",
    progress: 0,
    stage: "排队中",
    overallExecutionMode: "real",
    values: input.values,
    executionPlan: [],
    provenance: [],
    idempotencyKey: input.idempotencyKey,
    parentJobId: input.parentJobId,
    cancelRequested: false,
    providerCancelState: "none",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const parseAdScriptRoute = createRoute({
  method: "post",
  path: "/api/ad-script/parse",
  operationId: "parseAdScriptSource",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ sourceScript: z.string().trim().min(20).max(10_000) }) } },
    },
  },
  responses: {
    202: { description: "Parse accepted", content: { "application/json": { schema: JobSchema } } },
    422: { description: "Invalid script", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(parseAdScriptRoute, async (c) => {
  const ownerUserId = c.get("userId");
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim().slice(0, 128);
  if (idempotencyKey) {
    const existing = store.getByIdempotencyKey(ownerUserId, idempotencyKey);
    if (existing) return c.json(existing, 202);
  }
  const job = adScriptJobRecord({
    ownerUserId,
    title: "解析已有口播脚本",
    values: { operation: "parse-source", sourceScript: c.req.valid("json").sourceScript },
    idempotencyKey,
  });
  store.create(job);
  await queue.enqueue(job.id);
  return c.json(job, 202);
});

const createAdScriptProjectRoute = createRoute({
  method: "post",
  path: "/api/ad-script/projects",
  operationId: "createAdScriptProject",
  request: {
    body: { required: true, content: { "application/json": { schema: AdScriptInputSchema } } },
  },
  responses: {
    202: { description: "Generation accepted", content: { "application/json": { schema: AdScriptProjectSchema } } },
    409: { description: "Idempotency conflict", content: { "application/json": { schema: ErrorSchema } } },
    422: { description: "Insufficient credits", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(createAdScriptProjectRoute, async (c) => {
  const ownerUserId = c.get("userId");
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim().slice(0, 128) ?? crypto.randomUUID();
  const prior = adScripts.getByIdempotencyKey(ownerUserId, idempotencyKey);
  if (prior) return c.json(prior, 202);
  const input = c.req.valid("json");
  const projectId = crypto.randomUUID();
  const job = adScriptJobRecord({
    ownerUserId,
    title: `${input.productName} · ${input.batchCount} 条口播脚本`,
    values: { operation: "generate", projectId, model: AD_SCRIPT_MODEL },
    idempotencyKey,
  });
  try {
    const aggregate = adScripts.createCharged({ projectId, ownerUserId, projectInput: input, idempotencyKey, job });
    await queue.enqueue(job.id);
    return c.json(aggregate, 202);
  } catch (error) {
    if (error instanceof InsufficientCreditsError)
      return c.json(
        {
          error: {
            code: "INSUFFICIENT_CREDITS",
            message: `创建 ${input.batchCount} 条脚本需要 ${input.batchCount * AD_SCRIPT_CREDITS_PER_VARIANT} 创作点`,
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        },
        422,
      );
    throw error;
  }
});

const listAdScriptProjectsRoute = createRoute({
  method: "get",
  path: "/api/ad-script/projects",
  operationId: "listAdScriptProjects",
  responses: {
    200: {
      description: "Ad script projects",
      content: { "application/json": { schema: z.object({ projects: z.array(AdScriptProjectSchema) }) } },
    },
  },
});
app.openapi(listAdScriptProjectsRoute, (c) => c.json({ projects: adScripts.listOwned(c.get("userId")) }, 200));

const getAdScriptProjectRoute = createRoute({
  method: "get",
  path: "/api/ad-script/projects/{projectId}",
  operationId: "getAdScriptProject",
  request: { params: z.object({ projectId: z.string().uuid() }) },
  responses: {
    200: { description: "Ad script project", content: { "application/json": { schema: AdScriptProjectSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(getAdScriptProjectRoute, (c) => {
  const aggregate = adScripts.getOwned(c.req.valid("param").projectId, c.get("userId"));
  return aggregate
    ? c.json(aggregate, 200)
    : c.json(
        {
          error: { code: "NOT_FOUND", message: "口播脚本项目不存在", retryable: false, requestId: crypto.randomUUID() },
        },
        404,
      );
});

const saveAdScriptVersionRoute = createRoute({
  method: "post",
  path: "/api/ad-script/projects/{projectId}/variants/{variantId}/versions",
  operationId: "saveAdScriptVersion",
  request: {
    params: z.object({ projectId: z.string().uuid(), variantId: z.string().uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ expectedVersionId: z.string().uuid(), script: z.string().trim().min(20).max(4_000) }),
        },
      },
    },
  },
  responses: {
    201: { description: "Version saved", content: { "application/json": { schema: AdScriptProjectSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Version conflict", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(saveAdScriptVersionRoute, (c) => {
  const { projectId, variantId } = c.req.valid("param");
  const body = c.req.valid("json");
  const aggregate = adScripts.getOwned(projectId, c.get("userId"));
  const variant = aggregate?.variants.find((item) => item.id === variantId);
  const current = variant?.versions.find((version) => version.id === variant.currentVersionId);
  if (!aggregate || !variant || !current)
    return c.json(
      { error: { code: "NOT_FOUND", message: "脚本版本不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  try {
    adScripts.saveHumanVersion({
      projectId,
      variantId,
      ownerUserId: c.get("userId"),
      expectedVersionId: body.expectedVersionId,
      script: body.script,
      score: current.score,
      compliance: checkAdScriptCompliance(body.script, aggregate.project.input),
    });
    const updated = adScripts.getOwned(projectId, c.get("userId"));
    if (!updated) throw new Error("AD_SCRIPT_PROJECT_NOT_FOUND");
    return c.json(updated, 201);
  } catch (error) {
    if (error instanceof AdScriptVersionConflictError)
      return c.json(
        {
          error: {
            code: "VERSION_CONFLICT",
            message: error.message,
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        },
        409,
      );
    throw error;
  }
});

const createAdScriptActionRoute = createRoute({
  method: "post",
  path: "/api/ad-script/projects/{projectId}/variants/{variantId}/actions/{action}",
  operationId: "createAdScriptAction",
  request: {
    params: z.object({
      projectId: z.string().uuid(),
      variantId: z.string().uuid(),
      action: z.enum(["rescore", "continue"]),
    }),
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ versionId: z.string().uuid() }) } },
    },
  },
  responses: {
    202: { description: "Action accepted", content: { "application/json": { schema: JobSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(createAdScriptActionRoute, async (c) => {
  const { projectId, variantId, action } = c.req.valid("param");
  const versionId = c.req.valid("json").versionId;
  const aggregate = adScripts.getOwned(projectId, c.get("userId"));
  const variant = aggregate?.variants.find((item) => item.id === variantId);
  const version = variant?.versions.find((item) => item.id === versionId);
  if (!aggregate || !variant || !version)
    return c.json(
      { error: { code: "NOT_FOUND", message: "脚本版本不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim().slice(0, 128);
  if (idempotencyKey) {
    const existing = store.getByIdempotencyKey(c.get("userId"), idempotencyKey);
    if (existing) return c.json(existing, 202);
  }
  const job = adScriptJobRecord({
    ownerUserId: c.get("userId"),
    title: `${aggregate.project.input.productName} · ${action === "rescore" ? "重新评分" : "继续调优"}`,
    values: { operation: action, projectId, variantId, versionId, model: AD_SCRIPT_MODEL },
    idempotencyKey,
    parentJobId: aggregate.project.jobId ?? undefined,
  });
  store.create(job);
  await queue.enqueue(job.id);
  return c.json(job, 202);
});

const exportAdScriptRoute = createRoute({
  method: "get",
  path: "/api/ad-script/projects/{projectId}/variants/{variantId}/export",
  operationId: "exportAdScriptVersion",
  request: {
    params: z.object({ projectId: z.string().uuid(), variantId: z.string().uuid() }),
    query: z.object({ format: z.enum(["txt", "md"]), versionId: z.string().uuid().optional() }),
  },
  responses: {
    200: { description: "Exported script", content: { "text/plain": { schema: z.string() } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(exportAdScriptRoute, (c) => {
  const { projectId, variantId } = c.req.valid("param");
  const query = c.req.valid("query");
  const aggregate = adScripts.getOwned(projectId, c.get("userId"));
  const variant = aggregate?.variants.find((item) => item.id === variantId);
  const version = variant?.versions.find((item) => item.id === (query.versionId ?? variant.currentVersionId));
  if (!aggregate || !variant || !version)
    return c.json(
      { error: { code: "NOT_FOUND", message: "脚本版本不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  c.header("Content-Disposition", `attachment; filename="ad-script-${variant.ordinal}.${query.format}"`);
  const content =
    query.format === "md"
      ? `# ${aggregate.project.input.productName}口播脚本 ${variant.ordinal}\n\n${version.script}\n\n---\n\n评分：${version.score.total}/100\n`
      : version.script;
  return c.text(content, 200);
});

function videoCreateJobRecord(input: {
  ownerUserId: string;
  title: string;
  values: Record<string, string>;
  idempotencyKey?: string;
  videoModel?: JobRecord["videoModel"];
}): JobRecord {
  const timestamp = new Date().toISOString();
  const operation = input.values.operation;
  const local = operation === "compose";
  const mockVideo = operation === "shot" && env.mockGenerateVideoApi;
  return {
    id: crypto.randomUUID(),
    ownerUserId: input.ownerUserId,
    moduleId: "video-create",
    title: input.title,
    status: "queued",
    progress: 0,
    stage: "排队中",
    overallExecutionMode: mockVideo ? "mock" : local ? "local" : "real",
    values: input.values,
    videoModel: input.videoModel,
    executionPlan: [
      {
        id: `plan:0:${operation}`,
        capability: operation,
        executionMode: mockVideo ? "mock" : local ? "local" : "real",
        implementation: mockVideo
          ? "ffmpeg-seedance-mock"
          : local
            ? "ffmpeg-concat"
            : operation === "analyze"
              ? "aihubmix-gpt-image-analysis"
              : operation === "shot"
                ? "aihubmix-video"
                : "aihubmix-text",
        provider: local || mockVideo ? undefined : "aihubmix",
        model: mockVideo
          ? undefined
          : operation === "analyze"
            ? VIDEO_CREATE_ANALYSIS_MODEL
            : operation === "shot"
              ? input.videoModel
              : local
                ? undefined
                : "deepseek-v4-pro",
        startedAt: "",
      },
    ],
    provenance: [],
    idempotencyKey: input.idempotencyKey,
    cancelRequested: false,
    providerCancelState: "none",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function videoCreateAssetsAvailable(ownerUserId: string, input: z.infer<typeof VideoCreateInputSchema>) {
  const productAssets = input.productAssetIds.map((id) => accounts.getOwnedAsset(ownerUserId, id));
  if (productAssets.some((asset) => !asset?.mimeType.startsWith("image/"))) return false;
  if (input.portraitId && !getPortraitById(input.portraitId)) return false;
  if (input.voiceAssetId && !accounts.getOwnedAsset(ownerUserId, input.voiceAssetId)?.mimeType.startsWith("audio/"))
    return false;
  return true;
}

const createVideoCreateProjectRoute = createRoute({
  method: "post",
  path: "/api/video-create/projects",
  operationId: "createVideoCreateProject",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ title: z.string().trim().min(1).max(100), input: VideoCreateInputSchema }),
        },
      },
    },
  },
  responses: {
    201: { description: "Video create project", content: { "application/json": { schema: VideoCreateProjectSchema } } },
    422: { description: "Invalid assets", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(createVideoCreateProjectRoute, (c) => {
  const body = c.req.valid("json");
  const ownerUserId = c.get("userId");
  if (!videoCreateAssetsAvailable(ownerUserId, body.input))
    return c.json(
      {
        error: {
          code: "ASSET_NOT_AVAILABLE",
          message: "商品、人像或音色素材不可用",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      422,
    );
  const project = videoCreates.createDraft({
    id: crypto.randomUUID(),
    ownerUserId,
    title: body.title,
    projectInput: body.input,
    idempotencyKey: c.req.header("Idempotency-Key")?.trim().slice(0, 128),
  });
  return c.json(project, 201);
});

const listVideoCreateProjectsRoute = createRoute({
  method: "get",
  path: "/api/video-create/projects",
  operationId: "listVideoCreateProjects",
  responses: {
    200: {
      description: "Video create projects",
      content: { "application/json": { schema: z.object({ projects: z.array(VideoCreateProjectSchema) }) } },
    },
  },
});
app.openapi(listVideoCreateProjectsRoute, (c) => c.json({ projects: videoCreates.listOwned(c.get("userId")) }, 200));

const getVideoCreateProjectRoute = createRoute({
  method: "get",
  path: "/api/video-create/projects/{projectId}",
  operationId: "getVideoCreateProject",
  request: { params: z.object({ projectId: z.string().uuid() }) },
  responses: {
    200: { description: "Video create project", content: { "application/json": { schema: VideoCreateProjectSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(getVideoCreateProjectRoute, (c) => {
  const project = videoCreates.getOwned(c.req.valid("param").projectId, c.get("userId"));
  return project
    ? c.json(project, 200)
    : c.json(
        {
          error: { code: "NOT_FOUND", message: "一键成片项目不存在", retryable: false, requestId: crypto.randomUUID() },
        },
        404,
      );
});

const updateVideoCreateProjectRoute = createRoute({
  method: "patch",
  path: "/api/video-create/projects/{projectId}",
  operationId: "updateVideoCreateProject",
  request: {
    params: z.object({ projectId: z.string().uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ expectedVersion: z.number().int().min(1), input: VideoCreateInputSchema }),
        },
      },
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: VideoCreateProjectSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Version conflict", content: { "application/json": { schema: ErrorSchema } } },
    422: { description: "Invalid state or assets", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(updateVideoCreateProjectRoute, (c) => {
  const { projectId } = c.req.valid("param");
  const body = c.req.valid("json");
  const ownerUserId = c.get("userId");
  if (!videoCreateAssetsAvailable(ownerUserId, body.input))
    return c.json(
      {
        error: {
          code: "ASSET_NOT_AVAILABLE",
          message: "商品、人像或音色素材不可用",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      422,
    );
  try {
    const project = videoCreates.updateInput(projectId, ownerUserId, body.expectedVersion, body.input);
    return project
      ? c.json(project, 200)
      : c.json(
          {
            error: {
              code: "NOT_FOUND",
              message: "一键成片项目不存在",
              retryable: false,
              requestId: crypto.randomUUID(),
            },
          },
          404,
        );
  } catch (error) {
    const conflict = error instanceof VideoCreateVersionConflictError;
    return c.json(
      {
        error: {
          code: conflict ? "VERSION_CONFLICT" : "INVALID_STATE",
          message: error instanceof Error ? error.message : "项目更新失败",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      conflict ? 409 : 422,
    );
  }
});

const saveVideoCreateSectionRoute = createRoute({
  method: "patch",
  path: "/api/video-create/projects/{projectId}/sections/{sectionId}",
  operationId: "saveVideoCreateSection",
  request: {
    params: z.object({ projectId: z.string().uuid(), sectionId: z.string().uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            expectedVersionId: z.string().uuid(),
            text: z.string().trim().min(1).max(1_000),
            durationSec: z.number().int().min(1).max(180),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: "Saved", content: { "application/json": { schema: VideoCreateProjectSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Version conflict", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(saveVideoCreateSectionRoute, (c) => {
  const { projectId, sectionId } = c.req.valid("param");
  const body = c.req.valid("json");
  if (!videoCreates.getOwned(projectId, c.get("userId")))
    return c.json(
      { error: { code: "NOT_FOUND", message: "脚本段落不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  try {
    videoCreates.appendScriptVersion({ projectId, sectionId, ...body, source: "human" });
    const updated = videoCreates.getOwned(projectId, c.get("userId"));
    if (!updated)
      return c.json(
        { error: { code: "NOT_FOUND", message: "脚本项目不存在", retryable: false, requestId: crypto.randomUUID() } },
        404,
      );
    return c.json(updated, 200);
  } catch (error) {
    return c.json(
      {
        error: {
          code: "VERSION_CONFLICT",
          message: error instanceof Error ? error.message : "脚本版本冲突",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  }
});

async function enqueueVideoCreateOperation(input: {
  ownerUserId: string;
  projectId: string;
  operation: "analyze" | "script" | "regenerate-section" | "storyboard" | "shot" | "compose";
  idempotencyKey?: string;
  sectionId?: string;
  shotId?: string;
  expectedVersionId?: string;
}) {
  if (input.idempotencyKey) {
    const existing = store.getByIdempotencyKey(input.ownerUserId, input.idempotencyKey);
    if (existing) return existing;
  }
  const aggregate = videoCreates.getOwned(input.projectId, input.ownerUserId);
  if (!aggregate) throw new VideoCreateStateError("一键成片项目不存在");
  const shot = input.shotId ? aggregate.shots.find((item) => item.id === input.shotId) : undefined;
  const referenceId = aggregate.project.input.productAssetIds[0];
  const values = {
    ...videoCreateJobValues(input),
    ...(shot
      ? {
          prompt: shot.prompt,
          durationSec: String(shot.durationSec),
          ratio: aggregate.project.input.ratio,
          generateAudio: String(shot.audioEnabled),
          ...(aggregate.project.input.portraitId
            ? { portraitId: String(aggregate.project.input.portraitId) }
            : referenceId
              ? { reference: `asset:${referenceId}:reference` }
              : {}),
          ...(aggregate.project.input.voiceAssetId
            ? { voiceReference: `asset:${aggregate.project.input.voiceAssetId}:voice` }
            : {}),
        }
      : {}),
  };
  const job = videoCreateJobRecord({
    ownerUserId: input.ownerUserId,
    title: `${aggregate.project.title} · ${input.operation}`,
    values,
    idempotencyKey: input.idempotencyKey,
    videoModel: input.operation === "shot" ? aggregate.project.input.videoModel : undefined,
  });
  store.create(job);
  if (shot) videoCreates.updateShot(shot.id, { status: "queued", jobId: job.id, error: null });
  else
    videoCreates.setProject(input.projectId, {
      status: nextVideoCreateStatus(input.operation),
      currentJobId: job.id,
      error: null,
    });
  await queue.enqueue(job.id);
  return job;
}

const runVideoCreateActionRoute = createRoute({
  method: "post",
  path: "/api/video-create/projects/{projectId}/actions/{action}",
  operationId: "runVideoCreateAction",
  request: {
    params: z.object({
      projectId: z.string().uuid(),
      action: z.enum(["analyze", "script", "storyboard", "compose"]),
    }),
  },
  responses: {
    202: { description: "Accepted", content: { "application/json": { schema: JobSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Invalid state", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(runVideoCreateActionRoute, async (c) => {
  const { projectId, action } = c.req.valid("param");
  const aggregate = videoCreates.getOwned(projectId, c.get("userId"));
  if (!aggregate)
    return c.json(
      { error: { code: "NOT_FOUND", message: "一键成片项目不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  if (["analyzing", "script_generating", "storyboard_generating", "composing"].includes(aggregate.project.status))
    return c.json(
      {
        error: {
          code: "ACTION_IN_PROGRESS",
          message: "当前阶段已有任务执行中",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  if (action === "storyboard" && !aggregate.sections.length)
    return c.json(
      {
        error: {
          code: "SCRIPT_REQUIRED",
          message: "请先生成并确认脚本",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  if (action === "script" && (!aggregate.project.input.productName || !aggregate.project.input.sellingPoints.length))
    return c.json(
      {
        error: {
          code: "PRODUCT_DETAILS_REQUIRED",
          message: "请填写产品名称和至少一条核心卖点",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  if (action === "script" && aggregate.project.input.segmentCount < Math.ceil(aggregate.project.input.durationSec / 15))
    return c.json(
      {
        error: {
          code: "SEGMENT_COUNT_TOO_LOW",
          message: "每个分镜最长 15 秒，请增加分镜段数",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  if (action === "compose" && !aggregate.canCompose)
    return c.json(
      {
        error: {
          code: "SHOTS_NOT_READY",
          message: "全部分镜就绪后才能合并",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  const job = await enqueueVideoCreateOperation({
    ownerUserId: c.get("userId"),
    projectId,
    operation: action,
    idempotencyKey: c.req.header("Idempotency-Key")?.trim().slice(0, 128),
  });
  return c.json(job, 202);
});

const regenerateVideoCreateSectionRoute = createRoute({
  method: "post",
  path: "/api/video-create/projects/{projectId}/sections/{sectionId}/regenerate",
  operationId: "regenerateVideoCreateSection",
  request: {
    params: z.object({ projectId: z.string().uuid(), sectionId: z.string().uuid() }),
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ expectedVersionId: z.string().uuid() }) } },
    },
  },
  responses: {
    202: { description: "Accepted", content: { "application/json": { schema: JobSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Already generating", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(regenerateVideoCreateSectionRoute, async (c) => {
  const { projectId, sectionId } = c.req.valid("param");
  const aggregate = videoCreates.getOwned(projectId, c.get("userId"));
  const section = aggregate?.sections.find((item) => item.id === sectionId);
  if (!section)
    return c.json(
      { error: { code: "NOT_FOUND", message: "脚本段落不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  const job = await enqueueVideoCreateOperation({
    ownerUserId: c.get("userId"),
    projectId,
    operation: "regenerate-section",
    sectionId,
    expectedVersionId: c.req.valid("json").expectedVersionId,
    idempotencyKey: c.req.header("Idempotency-Key")?.trim().slice(0, 128),
  });
  return c.json(job, 202);
});

const generateVideoCreateShotRoute = createRoute({
  method: "post",
  path: "/api/video-create/projects/{projectId}/shots/{shotId}/generate",
  operationId: "generateVideoCreateShot",
  request: { params: z.object({ projectId: z.string().uuid(), shotId: z.string().uuid() }) },
  responses: {
    202: { description: "Accepted", content: { "application/json": { schema: JobSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Already generating", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(generateVideoCreateShotRoute, async (c) => {
  const { projectId, shotId } = c.req.valid("param");
  const shot = videoCreates.getOwnedShot(projectId, shotId, c.get("userId"));
  if (!shot)
    return c.json(
      { error: { code: "NOT_FOUND", message: "分镜不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  if (shot.status === "queued" || shot.status === "generating")
    return c.json(
      {
        error: {
          code: "ACTION_IN_PROGRESS",
          message: "该分镜正在生成中",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  const job = await enqueueVideoCreateOperation({
    ownerUserId: c.get("userId"),
    projectId,
    operation: "shot",
    shotId,
    idempotencyKey: c.req.header("Idempotency-Key")?.trim().slice(0, 128),
  });
  return c.json(job, 202);
});

const replaceVideoCreateShotRoute = createRoute({
  method: "post",
  path: "/api/video-create/projects/{projectId}/shots/{shotId}/replacement",
  operationId: "replaceVideoCreateShot",
  request: {
    params: z.object({ projectId: z.string().uuid(), shotId: z.string().uuid() }),
    body: { required: true, content: { "application/json": { schema: z.object({ assetId: z.string().uuid() }) } } },
  },
  responses: {
    200: { description: "Replaced", content: { "application/json": { schema: VideoCreateProjectSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    422: { description: "Invalid video", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(replaceVideoCreateShotRoute, (c) => {
  const { projectId, shotId } = c.req.valid("param");
  const shot = videoCreates.getOwnedShot(projectId, shotId, c.get("userId"));
  if (!shot)
    return c.json(
      { error: { code: "NOT_FOUND", message: "分镜不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  const asset = accounts.getOwnedAsset(c.get("userId"), c.req.valid("json").assetId);
  if (!asset?.mimeType.startsWith("video/"))
    return c.json(
      {
        error: {
          code: "INVALID_VIDEO_ASSET",
          message: "替代素材必须是本人上传的视频",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      422,
    );
  videoCreates.updateShot(shot.id, { status: "replaced", videoAssetId: asset.id, error: null });
  const updated = videoCreates.getOwned(projectId, c.get("userId"));
  return updated
    ? c.json(updated, 200)
    : c.json(
        {
          error: { code: "NOT_FOUND", message: "一键成片项目不存在", retryable: false, requestId: crypto.randomUUID() },
        },
        404,
      );
});

const updateVideoCreateShotSettingsRoute = createRoute({
  method: "patch",
  path: "/api/video-create/projects/{projectId}/shots/{shotId}",
  operationId: "updateVideoCreateShotSettings",
  request: {
    params: z.object({ projectId: z.string().uuid(), shotId: z.string().uuid() }),
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ audioEnabled: z.boolean(), subtitleEnabled: z.boolean() }) },
      },
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: VideoCreateProjectSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(updateVideoCreateShotSettingsRoute, (c) => {
  const { projectId, shotId } = c.req.valid("param");
  const shot = videoCreates.getOwnedShot(projectId, shotId, c.get("userId"));
  if (!shot)
    return c.json(
      { error: { code: "NOT_FOUND", message: "分镜不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  videoCreates.updateShot(shot.id, c.req.valid("json"));
  const updated = videoCreates.getOwned(projectId, c.get("userId"));
  return updated
    ? c.json(updated, 200)
    : c.json(
        {
          error: { code: "NOT_FOUND", message: "一键成片项目不存在", retryable: false, requestId: crypto.randomUUID() },
        },
        404,
      );
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
app.openapi(createJobRoute, async (c) => {
  const moduleId = c.req.valid("param").moduleId as ModuleId;
  if (moduleId === "ad-script" || moduleId === "video-create")
    return c.json(
      {
        error: {
          code: "DEDICATED_WORKFLOW_REQUIRED",
          message: moduleId === "ad-script" ? "口播脚本必须通过专用创作流程提交" : "一键成片必须通过专用项目流程提交",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      422,
    );
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
  const availability = moduleFeatureAvailability(moduleId);
  if (!availability.enabled)
    return c.json(
      {
        error: {
          code: "PROVIDER_NOT_VERIFIED",
          message: availability.disabledReason ?? "相关 Provider 尚未检测通过",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      403,
    );
  const body = c.req.valid("json");
  const ownerUserId = c.get("userId");
  const jobValues = { ...body.values };
  let mashupConfig: VideoMashupConfig | undefined;
  if (moduleId === "voice-clone") {
    jobValues.operation = "synthesize";
    jobValues.voiceSource = "preset";
    jobValues.presetVoiceId = "zh_female_vv_uranus_bigtts";
    jobValues.synthesisSpeakerId = "";
    jobValues.parentJobId = "";
    jobValues.styleInstruction = "";
    jobValues.toneFidelity = "";
    jobValues.authorized = "";
    jobValues.consentReference = "";
    jobValues.consentScope = "";
    jobValues.consentExpiresAt = "";
    const invalidMessage = validateVoiceTaskValues(jobValues);
    if (invalidMessage)
      return c.json(
        {
          error: {
            code: "INVALID_VOICE_CLONE_CONFIG",
            message: invalidMessage,
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        },
        422,
      );
  }
  if (moduleId === "video-mashup" && jobValues.mergeMode !== "video-cut-clips") {
    try {
      mashupConfig = parseVideoMashupConfig(jobValues.config ?? "");
    } catch (error) {
      return c.json(
        {
          error: {
            code: "INVALID_VIDEO_MASHUP_CONFIG",
            message: error instanceof Error ? error.message : "混剪配置无效",
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        },
        422,
      );
    }
    const unavailable = mashupConfig.groups
      .flatMap((group) => group.assetIds)
      .find((assetId) => !accounts.getOwnedAsset(ownerUserId, assetId)?.mimeType.startsWith("video/"));
    if (unavailable)
      return c.json(
        {
          error: {
            code: "VIDEO_MASHUP_ASSET_NOT_AVAILABLE",
            message: "混剪素材不存在、不属于当前账号或不是视频",
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        },
        422,
      );
    jobValues.outputFolderId = mashupConfig.outputFolderId;
    jobValues.saveLocation = mashupConfig.outputFolderId;
  }
  if (
    moduleId === "video-cut" ||
    moduleId === "video-extract" ||
    moduleId === "video-editor" ||
    moduleId === "video-mashup"
  ) {
    const outputFolderId = jobValues.outputFolderId || accounts.getDefaultAssetFolderId(ownerUserId);
    if (!accounts.getAssetFolder(ownerUserId, outputFolderId))
      return c.json(
        {
          error: {
            code: "OUTPUT_FOLDER_NOT_FOUND",
            message: "保存文件夹不存在或不属于当前账号",
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        },
        422,
      );
    jobValues.outputFolderId = outputFolderId;
    jobValues.saveLocation = outputFolderId;
  }
  if (moduleId === "video-extract") {
    try {
      const url = new URL(jobValues.url ?? "");
      if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error();
    } catch {
      return c.json(
        {
          error: {
            code: "INVALID_VIDEO_URL",
            message: "请输入有效的 HTTP 或 HTTPS 视频地址",
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        },
        422,
      );
    }
  }
  const needsVideoModel = moduleId === "video-remix" || (moduleId === "ai-generate" && body.values.type === "视频");
  let creationQuote = 0;
  if (moduleId === "ai-generate" && body.values.creationKind) {
    const models = creationCapabilities(videoModelEnabled, env.mockGenerateVideoApi ? "mock" : "real");
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
  const referencedIds = referencedAssetIds(jobValues);
  const isClipMerge = moduleId === "video-cut" && jobValues.mergeMode === "video-cut-clips";
  if (isClipMerge && referencedIds.length < 2)
    return c.json(
      {
        error: {
          code: "INSUFFICIENT_MERGE_CLIPS",
          message: "至少选择两个视频片段才能合并",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      422,
    );
  const unavailableAsset = referencedIds.find((id) => !accounts.ownsAsset(ownerUserId, id));
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
  const invalidMergeAsset = isClipMerge
    ? referencedIds.find((id) => !accounts.getOwnedAsset(ownerUserId, id)?.mimeType.startsWith("video/"))
    : undefined;
  if (invalidMergeAsset)
    return c.json(
      {
        error: {
          code: "INVALID_MERGE_ASSET",
          message: "合并任务仅支持视频片段",
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
  const requestedParentJobId = jobValues.parentJobId?.trim();
  const parentJob = requestedParentJobId ? store.getOwned(requestedParentJobId, ownerUserId) : undefined;
  if (requestedParentJobId && (!parentJob || parentJob.moduleId !== moduleId || parentJob.status !== "succeeded"))
    return c.json(
      {
        error: {
          code: "INVALID_PARENT_JOB",
          message: "关联的上游任务不存在、未完成或不属于当前账号",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      422,
    );
  const job: JobRecord = {
    id,
    ownerUserId,
    moduleId,
    title: body.title,
    status: "queued",
    progress: 0,
    stage: "排队中",
    overallExecutionMode: "mock",
    values: jobValues,
    videoModel: body.videoModel,
    executionPlan: [],
    provenance: [],
    idempotencyKey,
    parentJobId: parentJob?.id,
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
  await queue.enqueue(id);
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
app.openapi(cancelRoute, async (c) => {
  const id = c.req.valid("param").jobId;
  const job = store.getOwned(id, c.get("userId"));
  if (!job)
    return c.json(
      { error: { code: "NOT_FOUND", message: "任务不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  if (job.status === "queued") {
    const cancelled = store.update(id, { status: "cancelled", cancelRequested: true, stage: "已取消" }) ?? job;
    cancelQueuedAdScript(job);
    await queue.remove(id).catch(() => undefined);
    return c.json(cancelled, 200);
  }
  return c.json(store.update(id, { cancelRequested: true, stage: "正在取消" }) ?? job, 200);
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
app.openapi(retryRoute, async (c) => {
  const source = store.getOwned(c.req.valid("param").jobId, c.get("userId"));
  if (!source)
    return c.json(
      { error: { code: "NOT_FOUND", message: "任务不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  if (source.moduleId === "ad-script")
    return c.json(
      {
        error: {
          code: "DEDICATED_WORKFLOW_REQUIRED",
          message: "请在口播脚本结果页重新生成或继续调优",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  if (!isModuleOpen(source.moduleId as ModuleId))
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
  await queue.enqueue(retry.id);
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
        event: ["succeeded", "partially_succeeded", "failed", "cancelled"].includes(job.status)
          ? "job.completed"
          : "job.updated",
        data: JSON.stringify(job),
      });
    };
    let latest = store.get(id);
    if (!latest) return;
    await send(latest);
    while (!stream.aborted) {
      const job = store.get(id);
      if (!job || ["succeeded", "partially_succeeded", "failed", "cancelled"].includes(job.status)) break;
      await stream.sleep(500);
      const next = store.get(id);
      if (next && next.updatedAt !== latest.updatedAt) {
        latest = next;
        await send(next);
      }
    }
    const terminal = store.get(id);
    if (terminal && terminal.updatedAt !== latest.updatedAt) await send(terminal);
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

// ── Share content import (multi-platform) ──────────────────────────────

const ShareCandidateSchema = z.object({
  raw: z.string(),
  platformId: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  label: z.string(),
});

const ShareParseRequestSchema = z.object({
  text: z.string().min(1).max(4096),
});

const ShareParseResponseSchema = z
  .object({
    candidates: z.array(ShareCandidateSchema),
  })
  .openapi("ShareParseResult");

const ShareImportRequestSchema = z.object({
  candidate: ShareCandidateSchema,
  folderId: z.string().uuid(),
});

const ShareImportResponseSchema = JobSchema.extend({
  values: z.record(z.string(), z.string()),
}).openapi("ShareImportJob");

// Parse: extract platform candidates from free text
const parseShareRoute = createRoute({
  method: "post",
  path: "/api/imports/share-content/parse",
  operationId: "parseShareContent",
  request: {
    body: { required: true, content: { "application/json": { schema: ShareParseRequestSchema } } },
  },
  responses: {
    200: { description: "Parsed candidates", content: { "application/json": { schema: ShareParseResponseSchema } } },
  },
});

app.openapi(parseShareRoute, (c) => {
  const { text } = c.req.valid("json");
  const candidates = shareParser.parse(text);
  return c.json({ candidates }, 200);
});

// Create import job from confirmed candidate
const createShareImportRoute = createRoute({
  method: "post",
  path: "/api/imports/share-content",
  operationId: "createShareImport",
  request: {
    body: { required: true, content: { "application/json": { schema: ShareImportRequestSchema } } },
  },
  responses: {
    202: { description: "Import job created", content: { "application/json": { schema: ShareImportResponseSchema } } },
    400: { description: "Invalid candidate or folder", content: { "application/json": { schema: ErrorSchema } } },
    422: {
      description: "Platform not supported for download",
      content: { "application/json": { schema: ErrorSchema } },
    },
  },
});

app.openapi(createShareImportRoute, async (c) => {
  const requestId = crypto.randomUUID();
  const ownerUserId = c.get("userId");
  const { candidate, folderId } = c.req.valid("json");

  // Validate folder ownership
  const folder = accounts.getAssetFolder(ownerUserId, folderId);
  if (!folder) {
    return c.json(
      { error: { code: "FOLDER_NOT_FOUND", message: "素材文件夹不存在或无权访问", retryable: false, requestId } },
      400,
    );
  }

  // Find adapter and normalize
  const adapter = shareParser.adapterFor(candidate.platformId);
  if (!adapter) {
    return c.json(
      {
        error: {
          code: "UNKNOWN_PLATFORM",
          message: `不支持的平台: ${candidate.platformId}`,
          retryable: false,
          requestId,
        },
      },
      400,
    );
  }

  const normalizedUrl = adapter.normalize(candidate);
  if (!normalizedUrl) {
    return c.json(
      { error: { code: "INVALID_CANDIDATE", message: "无法规范化候选链接", retryable: false, requestId } },
      400,
    );
  }

  // The store performs this check inside an immediate transaction so two
  // concurrent submissions cannot both create a job for the same link.
  const idempotencyKey = `sc-${ownerUserId}-${folderId}-${adapter.platformId}-${normalizedUrl}`.slice(0, 128);
  const existing = store.getByIdempotencyKey(ownerUserId, idempotencyKey);
  const existingAssetId = existing?.result?.artifacts.find((artifact) => artifact.mimeType.startsWith("video/"))?.id;
  // Reuse a completed import only while its resulting material still exists.
  // Asset deletion otherwise makes the historical success result stale.
  const replaceSucceededJobId =
    existing?.status === "succeeded" && (!existingAssetId || !accounts.getOwnedAsset(ownerUserId, existingAssetId))
      ? existing.id
      : undefined;

  const timestamp = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const job: JobRecord = {
    id: jobId,
    ownerUserId,
    moduleId: "share-content-import" as JobModuleId,
    title: `${adapter.displayName} 内容导入`,
    status: "queued",
    progress: 0,
    stage: "排队中",
    overallExecutionMode: adapter.supportsDownload ? "real" : "mock",
    values: {
      platformId: adapter.platformId,
      normalizedUrl,
      folderId,
      folderName: folder.name,
      downloadSupported: String(adapter.supportsDownload),
    },
    executionPlan: [
      {
        id: "plan:0:share-download",
        capability: "share-download",
        executionMode: adapter.supportsDownload ? "real" : "mock",
        implementation: adapter.supportsDownload ? "playwright-download" : "recognition-only",
        startedAt: "",
      },
    ],
    provenance: [],
    idempotencyKey,
    cancelRequested: false,
    providerCancelState: "none",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const created = store.createShareContentImport(job, replaceSucceededJobId);
  if (!created.created) return c.json(created.job, 202);
  await queue.enqueue(jobId);
  return c.json(job, 202);
});

// Query import job status (backward-compatible with old /api/douyin/imports/{jobId})
const getShareImportRoute = createRoute({
  method: "get",
  path: "/api/imports/share-content/{jobId}",
  operationId: "getShareImport",
  request: { params: z.object({ jobId: z.string().uuid() }) },
  responses: {
    200: { description: "Import job", content: { "application/json": { schema: ShareImportResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(getShareImportRoute, (c) => {
  const job = store.getOwned(c.req.valid("param").jobId, c.get("userId"));
  if (!job)
    return c.json(
      { error: { code: "NOT_FOUND", message: "导入任务不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  return c.json(job, 200);
});

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: { title: `${APP_CONFIG.projectName} AI 创作 API`, version: "0.1.0" },
});

export { app };
