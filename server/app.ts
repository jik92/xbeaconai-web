import { Buffer } from "node:buffer";
import { mkdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { aiToolModuleIds, isAiToolModuleId } from "../shared/jobs/ai-tool-modules";
import {
  normalizePortraitReference,
  type PortraitReference,
  serializePortraitReference,
} from "../shared/portraits/portrait-reference";
import {
  videoCreateVoiceContextText,
  videoCreateVoiceSettingsKey,
  videoCreateVoiceSpeechRate,
} from "../shared/video-create/media-settings";
import { parseVideoMashupConfig, type VideoMashupConfig } from "../shared/video-mashup/config";
import { parseRemixWorkspace, remixProjectStages } from "../shared/video-remix/project-records";
import {
  defaultRemixPromptToolConfig,
  remixCheckTypes,
  remixModifyPresetIds,
  remixPromptScopes,
  remixPromptToolLabels,
  remixPromptTools,
  remixReferenceModes,
  remixRepairRules,
  remixVoiceModes,
} from "../shared/video-remix/prompt-tools";
import { parseRemixAnalysisEntries, parseRemixSources, remixMaxSources } from "../shared/video-remix/workflow";
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
import { ProviderGenerationAuditStore } from "./audit/provider-generation-audit-store";
import { credentialDoctor } from "./byok/credential-doctor";
import {
  type ProviderCredentialName,
  providerCredentialNames,
  providerCredentials,
  providerIds,
} from "./byok/credential-store";
import { maxEnvKeyBytes, parseEnvKey, serializeEnvKey } from "./byok/env-key";
import {
  allProviderFeatureAvailability,
  moduleFeatureAvailability,
  providerFeatureAvailability,
} from "./byok/provider-feature-gate";
import { AiGenerateRequestSchema, normalizeAiGenerateValues } from "./creation/ai-generate-contract";
import { creationCapabilities, quoteCreation, validateCreationValues } from "./creation/capabilities";
import { env } from "./env";
import { emitLog } from "./imports/import-logger";
import { platformAdapters, ShareContentParser } from "./imports/share-content";

const shareParser = new ShareContentParser(platformAdapters);

import { stopAllAdminJobs } from "./jobs/admin-job-control";
import { BullJobQueue } from "./jobs/bull-job-queue";
import { InsufficientCreditsError, SqliteJobStore } from "./jobs/sqlite-job-store";
import { isSeedanceModelId, seedanceModelIds, videoModels } from "./models/video-models";
import { getPortraitById } from "./portraits/catalog";
import { type CustomPortraitRecord, CustomPortraitStore } from "./portraits/custom-portrait-store";
import { resolvePortraitReference } from "./portraits/portrait-resolver";
import { volcSpeech } from "./providers/volc-speech";
import { auditSdkRegistry } from "./sdk-registry";
import { ossutils } from "./storage/ossutils";
import { rollbackUploadedObjects, uploadFilesStrictly } from "./storage/strict-library-upload";
import type { JobModuleId, JobRecord } from "./types";
import { inlineUtf8ContentDisposition } from "./uploads/content-disposition";
import {
  directUploadExtensions,
  issueDirectUploadTicket,
  maxDirectUploadBytes,
  verifyDirectUploadTicket,
} from "./uploads/direct-upload";
import {
  buildVideoCreateShotGenerationPrompt,
  createFallbackVideoCreateShotPlan,
  fitVideoCreateShotPlanDuration,
  nextVideoCreateReferenceLabel,
  validateVideoCreateShotGenerationReferences,
  videoCreateReferenceRole,
} from "./video-create/shot-generation";
import {
  VIDEO_CREATE_ANALYSIS_MODEL,
  VideoCreateInputSchema,
  VideoCreateMaterialStorageKindSchema,
  VideoCreateMaterialVersionSourceSchema,
  VideoCreateMaterialVersionStatusSchema,
  VideoCreateProjectStatusSchema,
  VideoCreateRecommendationSchema,
  VideoCreateShotGenerationPlanSchema,
  VideoCreateShotStatusSchema,
  VideoCreateSubtitleStyleIdSchema,
  VideoCreateVoiceSettingsSchema,
} from "./video-create/types";
import {
  nextVideoCreateStatus,
  VideoCreateMaterialBusyError,
  VideoCreateStateError,
  VideoCreateStore,
  VideoCreateVersionConflictError,
  videoCreateBatchEligibleAudioShots,
  videoCreateBatchEligibleShots,
  videoCreateJobValues,
  videoCreateMaterialVersionJobDetails,
  videoCreateMinimumStoryboardCount,
  videoCreateShotNarration,
} from "./video-create/video-create-store";
import { groupRemixChildren, summarizeRemixProject } from "./video-remix/project-records";
import { preflightQwenVoiceSample, QwenVoiceSamplePreflightError } from "./voice/qwen-voice-sample-preflight";
import { validateQwenVoiceCloneValues } from "./voice/validate-qwen-voice-clone";

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
const backgroundJobTypes = ["douyin-video-import", "share-content-import", "portrait-asset-register"] as const;
const jobModuleIds = [...moduleIds, ...backgroundJobTypes] as const;
const ModuleSchema = z.enum(moduleIds).openapi("ModuleId");
const AiToolModuleSchema = z.enum(aiToolModuleIds).openapi("AiToolModuleId");
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
const VideoCreateMaterialVersionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  shotId: z.string().uuid(),
  source: VideoCreateMaterialVersionSourceSchema,
  status: VideoCreateMaterialVersionStatusSchema,
  storageKind: VideoCreateMaterialStorageKindSchema.nullable(),
  contentId: z.string().uuid().nullable(),
  inputVersionId: z.string().uuid().nullable(),
  jobId: z.string().uuid().nullable(),
  subtitlesComposed: z.boolean(),
  subtitleStyleId: VideoCreateSubtitleStyleIdSchema.nullable(),
  generation: z
    .object({
      model: z.string().nullable(),
      durationSec: z.number().nonnegative().nullable(),
      ratio: z.string().nullable(),
      resolution: z.string().nullable(),
      generateAudio: z.boolean().nullable(),
    })
    .nullable(),
  execution: z
    .object({
      submittedAt: z.string(),
      completedAt: z.string().nullable(),
      durationSec: z.number().nonnegative().nullable(),
    })
    .nullable(),
  error: ApiErrorSchema.nullish(),
  available: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const VideoCreateShotSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  scriptSectionId: z.string().uuid(),
  ordinal: z.number().int().min(1),
  prompt: z.string(),
  narration: z.string(),
  generationPlan: VideoCreateShotGenerationPlanSchema.nullable(),
  durationSec: z.number().int().min(1),
  status: VideoCreateShotStatusSchema,
  jobId: z.string().uuid().nullable(),
  videoAssetId: z.string().uuid().nullable(),
  currentMaterialVersionId: z.string().uuid().nullable(),
  materialProcessing: z.boolean(),
  subtitlesComposed: z.boolean(),
  audioArtifactId: z.string().uuid().nullable(),
  audioSettingsKey: z.string().nullable(),
  audioStale: z.boolean(),
  subtitleStyleStale: z.boolean(),
  subtitleCues: z.array(
    z.object({
      startSec: z.number().nonnegative(),
      endSec: z.number().nonnegative(),
      text: z.string(),
    }),
  ),
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
export const providerAudits = new ProviderGenerationAuditStore();
export const customPortraits = new CustomPortraitStore();
export const queue = new BullJobQueue((jobId) => store.get(jobId));
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
const isPublicApiPath = (path: string) => publicApiPaths.has(path) || /^\/api\/portraits\/\d+\/content$/.test(path);

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
  return isSeedanceModelId(modelId) && providerCredentials.isProviderVerified("ark");
}

function getCreationProviderStatus() {
  return {
    imageEnabled: providerCredentials.isProviderVerified("aihubmix"),
    videoEnabled: providerCredentials.isProviderVerified("ark"),
  };
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
  if (c.req.method === "OPTIONS" || isPublicApiPath(c.req.path)) return next();
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

const portraitContentRoute = createRoute({
  method: "get",
  path: "/api/portraits/{portraitId}/content",
  operationId: "getPortraitContent",
  request: { params: z.object({ portraitId: z.coerce.number().int().min(1) }) },
  responses: {
    200: {
      description: "Inline portrait image",
      content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } },
    },
    404: { description: "Portrait not found", content: { "application/json": { schema: ErrorSchema } } },
    502: { description: "Portrait source unavailable", content: { "application/json": { schema: ErrorSchema } } },
  },
});

function imageMimeType(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  const signature = new TextDecoder().decode(bytes.subarray(0, 12));
  if (signature.startsWith("GIF87a") || signature.startsWith("GIF89a")) return "image/gif";
  if (signature.startsWith("RIFF") && signature.slice(8, 12) === "WEBP") return "image/webp";
  if (signature.slice(4, 12) === "ftypavif" || signature.slice(4, 12) === "ftypavis") return "image/avif";
  return undefined;
}

app.openapi(portraitContentRoute, async (c) => {
  const requestId = crypto.randomUUID();
  const portrait = getPortraitById(c.req.valid("param").portraitId);
  if (!portrait)
    return c.json(
      {
        error: {
          code: "PORTRAIT_NOT_FOUND",
          message: "人像不存在",
          retryable: false,
          requestId,
        },
      },
      404,
    );
  try {
    const upstream = await fetch(portrait.source_url, { signal: AbortSignal.timeout(15_000) });
    const declaredMimeType = upstream.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (!upstream.ok || !declaredMimeType?.startsWith("image/"))
      return c.json(
        {
          error: {
            code: "PORTRAIT_SOURCE_INVALID",
            message: "人像图片源不可用",
            retryable: upstream.status >= 500,
            requestId,
          },
        },
        502,
      );
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    const mimeType = imageMimeType(bytes);
    if (!mimeType)
      return c.json(
        {
          error: {
            code: "PORTRAIT_SOURCE_INVALID",
            message: "人像图片源不可用",
            retryable: false,
            requestId,
          },
        },
        502,
      );
    return new Response(bytes, {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        "Content-Disposition": "inline",
        "Content-Type": mimeType,
      },
    });
  } catch {
    return c.json(
      {
        error: {
          code: "PORTRAIT_SOURCE_UNAVAILABLE",
          message: "人像图片加载失败",
          retryable: true,
          requestId,
        },
      },
      502,
    );
  }
});

function providerGuard(moduleId: ModuleId): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
    if (moduleId === "video-remix" && c.req.path.startsWith("/api/video-remix/projects/")) return next();
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
const BillingPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});
const AiRechargeRecordSchema = z
  .object({
    id: z.string().uuid(),
    source: z.enum(["mock_recharge", "admin_grant"]),
    credits: z.number().int().min(1),
    amountCny: z.number().int().nonnegative().optional(),
    balanceAfter: z.number().int().nonnegative(),
    status: z.literal("succeeded"),
    createdAt: z.string(),
  })
  .openapi("AiRechargeRecord");
const AiConsumptionRecordSchema = z
  .object({
    id: z.string().uuid(),
    jobId: z.string().uuid(),
    moduleId: JobModuleSchema.optional(),
    jobTitle: z.string().optional(),
    type: z.enum(["charge", "refund"]),
    creditChange: z.number().int(),
    balanceAfter: z.number().int().nonnegative(),
    note: z.string().optional(),
    createdAt: z.string(),
  })
  .openapi("AiConsumptionRecord");
const listAiRechargeRecordsRoute = createRoute({
  method: "get",
  path: "/api/billing/ai/recharges",
  operationId: "listAiRechargeRecords",
  request: { query: BillingPageQuerySchema },
  responses: {
    200: {
      description: "Owned AI recharge records",
      content: {
        "application/json": {
          schema: z.object({
            records: z.array(AiRechargeRecordSchema),
            total: z.number().int().nonnegative(),
            page: z.number().int().min(1),
            pageSize: z.number().int().min(1),
          }),
        },
      },
    },
  },
});
app.openapi(listAiRechargeRecordsRoute, (c) =>
  c.json(accounts.listAiRechargeRecords(c.get("userId"), c.req.valid("query")), 200),
);
const listAiConsumptionRecordsRoute = createRoute({
  method: "get",
  path: "/api/billing/ai/consumption",
  operationId: "listAiConsumptionRecords",
  request: { query: BillingPageQuerySchema },
  responses: {
    200: {
      description: "Owned AI consumption and refund records",
      content: {
        "application/json": {
          schema: z.object({
            records: z.array(AiConsumptionRecordSchema),
            total: z.number().int().nonnegative(),
            page: z.number().int().min(1),
            pageSize: z.number().int().min(1),
          }),
        },
      },
    },
  },
});
app.openapi(listAiConsumptionRecordsRoute, (c) =>
  c.json(accounts.listAiConsumptionRecords(c.get("userId"), c.req.valid("query")), 200),
);
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
              portraitCreation: FeatureAvailabilitySchema,
              voiceSynthesis: FeatureAvailabilitySchema,
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
  minReferences: z.number().int().min(0),
  maxReferences: z.number().int().min(0),
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
app.openapi(creationCapabilitiesRoute, (c) => {
  const providers = getCreationProviderStatus();
  return c.json({ models: creationCapabilities(providers.imageEnabled, providers.videoEnabled) }, 200);
});

app.use("/api/ai-generate/jobs", async (c, next) => {
  if (c.req.method === "POST") {
    const body = (await c.req.raw
      .clone()
      .json()
      .catch(() => undefined)) as { values?: unknown } | undefined;
    if (body && "values" in body)
      return c.json(
        {
          error: {
            code: "DEDICATED_WORKFLOW_REQUIRED",
            message: "AI 创作必须通过专用强类型接口提交",
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        },
        422,
      );
  }
  await next();
});

const createAiGenerateJobRoute = createRoute({
  method: "post",
  path: "/api/ai-generate/jobs",
  operationId: "createAiGenerateJob",
  request: {
    body: {
      content: { "application/json": { schema: AiGenerateRequestSchema } },
      required: true,
    },
  },
  responses: {
    202: { description: "Accepted", content: { "application/json": { schema: JobSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: ErrorSchema } } },
    403: { description: "Provider not verified", content: { "application/json": { schema: ErrorSchema } } },
    422: { description: "Invalid creation request", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createAiGenerateJobRoute, async (c) => {
  const ownerUserId = c.get("userId");
  const body = c.req.valid("json");
  const requiredProviders =
    body.kind === "image"
      ? (["aihubmix"] as const)
      : body.referenceAssetIds.length
        ? (["ark", "tos"] as const)
        : (["ark"] as const);
  const availability = providerFeatureAvailability([...requiredProviders]);
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

  const providers = getCreationProviderStatus();
  const models = creationCapabilities(providers.imageEnabled, providers.videoEnabled);
  const capabilityValues = {
    creationKind: body.kind,
    prompt: body.prompt,
    modelId: body.modelId,
    ratio: body.ratio,
    resolution: body.resolution,
    count: String(body.kind === "image" ? body.count : 1),
    duration: String(body.kind === "video" ? body.duration : 0),
    referenceMode: body.kind === "video" ? body.referenceMode : "",
    referenceCount: String(body.referenceAssetIds.length || (body.parentJobId && body.revisionMode !== "new" ? 1 : 0)),
    seed: "",
  };
  const validationError = validateCreationValues(capabilityValues, models);
  if (validationError)
    return c.json(
      {
        error: {
          code: "INVALID_AI_GENERATE_CONFIG",
          message: validationError,
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      422,
    );
  const model = models.find((item) => item.id === body.modelId && item.kind === body.kind);
  if (!model)
    return c.json(
      {
        error: {
          code: "INVALID_AI_GENERATE_CONFIG",
          message: "所选模型当前不可用",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      422,
    );
  const referenceMetadata: Array<{
    id: string;
    name: string;
    mimeType: string;
    label: string;
    source: "library";
  }> = [];
  const referenceCounts = new Map<string, number>();
  for (const assetId of body.referenceAssetIds) {
    const asset = accounts.getOwnedAsset(ownerUserId, assetId);
    if (!asset)
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
    const kind = asset.mimeType.startsWith("image/")
      ? "image"
      : asset.mimeType.startsWith("video/")
        ? "video"
        : asset.mimeType.startsWith("audio/")
          ? "audio"
          : undefined;
    if (!kind || !model.acceptedReferenceKinds.includes(kind))
      return c.json(
        {
          error: {
            code: "UNSUPPORTED_REFERENCE_TYPE",
            message: `所选模型不支持 ${asset.mimeType} 参考素材`,
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        },
        422,
      );
    const referenceNumber = (referenceCounts.get(kind) ?? 0) + 1;
    referenceCounts.set(kind, referenceNumber);
    referenceMetadata.push({
      id: asset.id,
      name: asset.displayName,
      mimeType: asset.mimeType,
      label: `${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}${referenceNumber}`,
      source: "library",
    });
  }

  const parentJob = body.parentJobId ? store.getOwned(body.parentJobId, ownerUserId) : undefined;
  if (body.parentJobId && (!parentJob || parentJob.moduleId !== "ai-generate" || parentJob.status !== "succeeded"))
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

  const idempotencyKey = c.req.header("Idempotency-Key")?.trim().slice(0, 128);
  if (idempotencyKey) {
    const existing = store.getByIdempotencyKey(ownerUserId, idempotencyKey);
    if (existing) return c.json(existing, 202);
  }
  const credits = quoteCreation(capabilityValues, models);
  const user = accounts.getUser(ownerUserId);
  if (!user || user.credits < credits)
    return c.json(
      {
        error: {
          code: "INSUFFICIENT_CREDITS",
          message: `本次预计消耗 ${credits} 创作点，当前余额不足`,
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      422,
    );

  const now = new Date().toISOString();
  const job: JobRecord = {
    id: crypto.randomUUID(),
    ownerUserId,
    moduleId: "ai-generate",
    title: body.title,
    status: "queued",
    progress: 0,
    stage: "排队中",
    overallExecutionMode: "real",
    values: {
      ...normalizeAiGenerateValues(body),
      referenceMetadata: JSON.stringify(referenceMetadata),
      allowMockFallback: "false",
    },
    videoModel: body.kind === "video" && isSeedanceModelId(body.modelId) ? body.modelId : undefined,
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
    store.createCharged(job, credits);
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
  await queue.enqueue(job.id);
  return c.json(job, 202);
});

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
    503: { description: "TOS storage unavailable", content: { "application/json": { schema: ErrorSchema } } },
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
  if (!ossutils.configured)
    return c.json(
      { error: { code: "TOS_NOT_CONFIGURED", message: "TOS 未配置，素材无法上传", retryable: true, requestId } },
      503,
    );
  // 素材库以 TOS 为唯一持久化存储；这里不再在 .data/uploads 留副本。
  await ossutils.putLibraryBytes({
    bytes: new Uint8Array(await file.arrayBuffer()),
    key: storageKey,
    mimeType: file.type,
  });
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

const CustomPortraitStatusSchema = z.enum(["queued", "processing", "active", "failed"]);
const CustomPortraitSchema = z.object({
  type: z.literal("custom"),
  assetId: z.string().uuid(),
  jobId: z.string().uuid().optional(),
  name: z.string(),
  description: z.string().optional(),
  gender: z.enum(["男", "女"]).optional(),
  imageUrl: z.string(),
  status: CustomPortraitStatusSchema,
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

function customPortraitResponse(record: CustomPortraitRecord) {
  const asset = accounts.getOwnedAsset(record.ownerUserId, record.assetId);
  if (!asset || asset.kind !== "portrait") return undefined;
  return {
    type: "custom" as const,
    assetId: record.assetId,
    jobId: record.jobId,
    name: asset.displayName,
    description: asset.description,
    gender: record.gender,
    imageUrl: `/api/assets/${asset.id}/content`,
    status: record.status,
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

const listCustomPortraitsRoute = createRoute({
  method: "get",
  path: "/api/portraits/custom",
  operationId: "listCustomPortraits",
  responses: {
    200: {
      description: "Current user's custom Ark virtual portraits",
      content: { "application/json": { schema: z.object({ portraits: z.array(CustomPortraitSchema) }) } },
    },
  },
});
app.openapi(listCustomPortraitsRoute, (c) =>
  c.json(
    {
      portraits: customPortraits
        .listOwned(c.get("userId"))
        .map(customPortraitResponse)
        .filter((portrait): portrait is NonNullable<typeof portrait> => Boolean(portrait)),
    },
    200,
  ),
);

const registerCustomPortraitRoute = createRoute({
  method: "post",
  path: "/api/portraits/custom",
  operationId: "registerCustomPortrait",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ assetId: z.string().uuid(), gender: z.enum(["男", "女"]) }) },
      },
    },
  },
  responses: {
    200: {
      description: "Custom portrait registration already exists",
      content: { "application/json": { schema: z.object({ portrait: CustomPortraitSchema }) } },
    },
    202: {
      description: "Custom portrait registration queued",
      content: { "application/json": { schema: z.object({ portrait: CustomPortraitSchema }) } },
    },
    404: { description: "Portrait source asset not found", content: { "application/json": { schema: ErrorSchema } } },
    413: { description: "Portrait source asset too large", content: { "application/json": { schema: ErrorSchema } } },
    415: { description: "Portrait source asset invalid", content: { "application/json": { schema: ErrorSchema } } },
    503: { description: "Ark portrait service unavailable", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(registerCustomPortraitRoute, async (c) => {
  const requestId = crypto.randomUUID();
  const ownerUserId = c.get("userId");
  const body = c.req.valid("json");
  const asset = accounts.getOwnedAsset(ownerUserId, body.assetId);
  if (!asset || asset.kind !== "portrait")
    return c.json(
      { error: { code: "PORTRAIT_ASSET_NOT_FOUND", message: "人像素材不存在", retryable: false, requestId } },
      404,
    );
  if (!asset.mimeType.startsWith("image/"))
    return c.json(
      { error: { code: "INVALID_PORTRAIT_IMAGE", message: "自建虚拟人像仅支持图片", retryable: false, requestId } },
      415,
    );
  if (asset.byteSize > 30 * 1024 * 1024)
    return c.json(
      { error: { code: "PORTRAIT_IMAGE_TOO_LARGE", message: "人像图片不能超过 30MB", retryable: false, requestId } },
      413,
    );
  if (!ossutils.configured)
    return c.json(
      { error: { code: "TOS_NOT_CONFIGURED", message: "自建虚拟人像素材中转未配置", retryable: false, requestId } },
      503,
    );
  const existing = customPortraits.getOwned(ownerUserId, asset.id);
  if (existing) return c.json({ portrait: customPortraitResponse(existing)! }, 200);

  const timestamp = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const job: JobRecord = {
    id: jobId,
    ownerUserId,
    moduleId: "portrait-asset-register",
    title: `创建虚拟人像：${asset.displayName}`,
    status: "queued",
    progress: 0,
    stage: "排队中",
    overallExecutionMode: "real",
    values: { assetId: asset.id, gender: body.gender },
    executionPlan: [
      {
        id: "plan:0:portrait-asset-register",
        capability: "portrait-asset-register",
        executionMode: "real",
        implementation: "ark-assets",
        provider: "ark",
        startedAt: "",
      },
    ],
    provenance: [],
    cancelRequested: false,
    providerCancelState: "none",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  store.create(job);
  const record = customPortraits.create({
    assetId: asset.id,
    jobId,
    ownerUserId,
    gender: body.gender,
    createdAt: timestamp,
  });
  if (!record) throw new Error("CUSTOM_PORTRAIT_CREATE_FAILED");
  try {
    await queue.enqueue(jobId);
  } catch (error) {
    customPortraits.update(asset.id, {
      status: "failed",
      errorCode: "QUEUE_UNAVAILABLE",
      errorMessage: error instanceof Error ? error.message : "任务队列不可用",
    });
    store.update(jobId, {
      status: "failed",
      stage: "排队失败",
      error: { code: "QUEUE_UNAVAILABLE", message: "任务队列不可用", retryable: true, requestId },
    });
    throw error;
  }
  return c.json({ portrait: customPortraitResponse(record)! }, 202);
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
    if (customPortraits.getOwned(c.get("userId"), c.req.valid("param").assetId))
      return c.json(
        {
          error: {
            code: "CUSTOM_PORTRAIT_DELETE_UNSUPPORTED",
            message: "自建虚拟人像暂不支持从素材库直接删除",
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        },
        409,
      );
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

const AssetFolderSchema = z
  .object({
    id: z.string().uuid(),
    parentId: z.string().uuid().optional(),
    name: z.string(),
    storagePrefix: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    isDefault: z.boolean().optional(),
  })
  .openapi("AssetFolder");

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

const getToolOutputFolderRoute = createRoute({
  method: "get",
  path: "/api/tool-output-folders/{moduleId}",
  operationId: "getToolOutputFolder",
  request: { params: z.object({ moduleId: AiToolModuleSchema }) },
  responses: {
    200: {
      description: "Resolved module output folder",
      content: { "application/json": { schema: z.object({ folder: AssetFolderSchema.optional() }) } },
    },
    400: { description: "Invalid AI tool module", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(getToolOutputFolderRoute, (c) => {
  const folder = accounts.getModuleOutputFolder(c.get("userId"), c.req.valid("param").moduleId);
  return c.json(folder ? { folder: folderResponse(folder) } : {}, 200);
});

const setToolOutputFolderRoute = createRoute({
  method: "put",
  path: "/api/tool-output-folders/{moduleId}",
  operationId: "setToolOutputFolder",
  request: {
    params: z.object({ moduleId: AiToolModuleSchema }),
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ folderId: z.string().uuid().optional() }) },
      },
    },
  },
  responses: {
    200: {
      description: "Updated module output folder",
      content: { "application/json": { schema: z.object({ folder: AssetFolderSchema.optional() }) } },
    },
    400: { description: "Invalid AI tool module", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Folder not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(setToolOutputFolderRoute, (c) => {
  try {
    const folder = accounts.setModuleOutputFolder(
      c.get("userId"),
      c.req.valid("param").moduleId,
      c.req.valid("json").folderId ?? undefined,
    );
    return c.json(folder ? { folder: folderResponse(folder) } : {}, 200);
  } catch (error) {
    if (error instanceof AccountError)
      return c.json(
        { error: { code: error.code, message: error.message, retryable: false, requestId: crypto.randomUUID() } },
        404,
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
  if (!ossutils.configured) return new Response("Not found", { status: 404 });
  try {
    await ossutils.headObject(asset.storageKey);
    return Response.redirect(ossutils.createSignedReadUrl(asset.storageKey), 302);
  } catch {
    return new Response("Not found", { status: 404 });
  }
});

const AdminCredentialSchema = z.object({
  name: ProviderCredentialNameSchema,
  providerId: ProviderIdSchema,
  provider: z.string(),
  docsUrl: z.string().url(),
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
const ProviderAuditStatusSchema = z.enum(["submitting", "processing", "succeeded", "failed", "cancelled"]);
const AdminProviderAuditSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string(),
  ownerUserId: z.string().uuid(),
  userPhone: z.string().optional(),
  userDisplayName: z.string().optional(),
  moduleId: z.string(),
  capability: z.string(),
  provider: z.string(),
  model: z.string().optional(),
  operation: z.string(),
  providerTaskId: z.string().optional(),
  providerRequestId: z.string().optional(),
  status: ProviderAuditStatusSchema,
  assetCount: z.number().int().nonnegative(),
  submittedAt: z.string(),
  completedAt: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
});
const AdminProviderAuditAssetSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  url: z.string(),
  available: z.boolean(),
});
const AdminProviderAuditDetailSchema = AdminProviderAuditSchema.extend({
  requestPayload: z.unknown(),
  responsePayload: z.unknown().optional(),
  errorPayload: z.unknown().optional(),
  assetIds: z.array(z.string()),
  assets: z.array(AdminProviderAuditAssetSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
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

const exportAdminEnvKeyRoute = createRoute({
  method: "get",
  path: "/api/admin/credentials/export",
  operationId: "exportAdminEnvKey",
  responses: {
    200: { description: "Exported env key", content: { "text/plain": { schema: z.string() } } },
    403: { description: "Admin required", content: { "application/json": { schema: ErrorSchema } } },
    503: { description: "BYOK unavailable", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(exportAdminEnvKeyRoute, (c) => {
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
  c.header("Content-Disposition", 'attachment; filename=".env.key"');
  c.header("Cache-Control", "no-store");
  return c.text(serializeEnvKey(providerCredentials.exportValues()), 200);
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
      { error: { code: "INVALID_ENV_KEY", message: "请选择有效的密钥文件", retryable: false, requestId } },
      400,
    );
  if (file.size > maxEnvKeyBytes)
    return c.json(
      { error: { code: "ENV_KEY_TOO_LARGE", message: "密钥文件不能超过 64KB", retryable: false, requestId } },
      413,
    );
  try {
    const parsed = parseEnvKey(await file.text());
    const updated = providerCredentials.setMissing(parsed.values, c.get("userId"));
    const updatedSet = new Set(updated);
    const provided = providerCredentialNames.filter((name) => Boolean(parsed.values[name]));
    return c.json(
      {
        updated,
        skipped: provided.filter((name) => !updatedSet.has(name)),
        ignored: parsed.ignored,
      },
      200,
    );
  } catch (error) {
    return c.json(
      {
        error: {
          code: "INVALID_ENV_KEY_CONTENT",
          message: error instanceof Error ? error.message : "密钥文件内容无效",
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

const listAdminProviderAuditsRoute = createRoute({
  method: "get",
  path: "/api/admin/provider-audits",
  operationId: "listAdminProviderAudits",
  request: {
    query: z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(10).max(100).default(25),
      query: z.string().trim().max(100).optional(),
      provider: z.string().trim().max(80).optional(),
      moduleId: z.string().trim().max(80).optional(),
      status: ProviderAuditStatusSchema.optional(),
      startedFrom: z.iso.datetime().optional(),
      startedTo: z.iso.datetime().optional(),
    }),
  },
  responses: {
    200: {
      description: "Third-party generation audit list",
      content: {
        "application/json": {
          schema: z.object({
            audits: z.array(AdminProviderAuditSchema),
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
app.openapi(listAdminProviderAuditsRoute, (c) => {
  if (!adminUser(c.get("userId")))
    return c.json(
      {
        error: { code: "ADMIN_REQUIRED", message: "仅管理员可访问", retryable: false, requestId: crypto.randomUUID() },
      },
      403,
    );
  return c.json(providerAudits.list(c.req.valid("query")), 200);
});

function adminProviderAuditAsset(auditId: string, assetId: string) {
  const audit = providerAudits.get(auditId);
  if (!audit?.assetIds.includes(assetId)) return undefined;
  const artifact = accounts.getArtifact(audit.ownerUserId, assetId);
  if (artifact)
    return {
      id: assetId,
      name: artifact.name,
      mimeType: artifact.mime_type,
      storageKey: artifact.storage_key,
      storageArea: "results" as const,
    };
  const asset = accounts.getOwnedAsset(audit.ownerUserId, assetId);
  if (!asset)
    return {
      id: assetId,
      name: assetId,
      mimeType: "",
      storageKey: undefined,
      storageArea: undefined,
      available: false as const,
    };
  return {
    id: assetId,
    name: asset.displayName || asset.originalName,
    mimeType: asset.mimeType,
    storageKey: asset.storageKey,
    storageArea: "uploads" as const,
  };
}

const getAdminProviderAuditRoute = createRoute({
  method: "get",
  path: "/api/admin/provider-audits/{auditId}",
  operationId: "getAdminProviderAudit",
  request: { params: z.object({ auditId: z.string().uuid() }) },
  responses: {
    200: {
      description: "Third-party generation audit detail",
      content: { "application/json": { schema: AdminProviderAuditDetailSchema } },
    },
    403: { description: "Admin required", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Audit not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(getAdminProviderAuditRoute, (c) => {
  const requestId = crypto.randomUUID();
  if (!adminUser(c.get("userId")))
    return c.json({ error: { code: "ADMIN_REQUIRED", message: "仅管理员可访问", retryable: false, requestId } }, 403);
  const audit = providerAudits.get(c.req.valid("param").auditId);
  if (!audit)
    return c.json({ error: { code: "AUDIT_NOT_FOUND", message: "审计记录不存在", retryable: false, requestId } }, 404);
  const assets = audit.assetIds.map((assetId) => {
    const asset = adminProviderAuditAsset(audit.id, assetId);
    return {
      id: assetId,
      name: asset?.name ?? assetId,
      mimeType: asset?.mimeType ?? "",
      url: asset?.storageKey ? `/api/admin/provider-audits/${audit.id}/assets/${assetId}` : "",
      available: Boolean(asset?.storageKey),
    };
  });
  return c.json({ ...audit, assets }, 200);
});

const previewAdminProviderAuditAssetRoute = createRoute({
  method: "get",
  path: "/api/admin/provider-audits/{auditId}/assets/{assetId}",
  operationId: "previewAdminProviderAuditAsset",
  request: { params: z.object({ auditId: z.string().uuid(), assetId: z.string() }) },
  responses: {
    200: {
      description: "Generated material binary",
      content: { "application/octet-stream": { schema: z.string().openapi({ format: "binary" }) } },
    },
    403: { description: "Admin required", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Material not found", content: { "text/plain": { schema: z.string() } } },
  },
});
app.openapi(previewAdminProviderAuditAssetRoute, async (c) => {
  if (!adminUser(c.get("userId")))
    return c.json(
      {
        error: { code: "ADMIN_REQUIRED", message: "仅管理员可访问", retryable: false, requestId: crypto.randomUUID() },
      },
      403,
    );
  const asset = adminProviderAuditAsset(c.req.valid("param").auditId, c.req.valid("param").assetId);
  if (!asset?.storageKey || !asset.storageArea) return new Response("Not found", { status: 404 });
  const file = Bun.file(resolve(env.dataDir, asset.storageArea, asset.storageKey));
  if (!(await file.exists())) {
    if (asset.storageArea !== "uploads" || !ossutils.configured) return new Response("Not found", { status: 404 });
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
      "Content-Disposition": inlineUtf8ContentDisposition(asset.name),
      "Cache-Control": "private, max-age=300",
    },
  });
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
  mode: z.enum(["product", "talking"]).default("product"),
  product: z.object({
    id: z.union([z.number(), z.string()]).nullable(),
    productName: z.string().min(1).max(200),
    productImages: z.array(remixFileSchema).min(1).max(20),
    productFormMetaList: z.array(z.unknown()).nullable().optional(),
    productFormDesc: z.string().nullable().optional(),
  }),
  demand: z.string().max(2_000).default(""),
  rawMaterialFiles: z.array(remixFileSchema).min(1).max(20),
  voiceAsset: remixFileSchema.nullable().optional(),
  portraitAssets: z
    .array(
      z.object({
        id: z.union([z.number(), z.string()]).nullable().optional(),
        reference: z
          .discriminatedUnion("type", [
            z.object({ type: z.literal("general"), portraitId: z.number().int().min(1) }),
            z.object({ type: z.literal("custom"), assetId: z.string().uuid() }),
          ])
          .optional(),
        assetName: z.string().min(1).max(100),
        fileInfo: z.array(
          z.object({
            fileUrl: z.string().min(1),
            coverUrl: z.string().min(1),
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

const RemixPromptToolConfigSchema = z.object({
  scope: z.enum(remixPromptScopes).default(defaultRemixPromptToolConfig.scope),
  referenceMode: z.enum(remixReferenceModes).default(defaultRemixPromptToolConfig.referenceMode),
  checkTypes: z
    .array(z.enum(remixCheckTypes))
    .max(remixCheckTypes.length)
    .default([...remixCheckTypes]),
  repairRules: z
    .array(z.enum(remixRepairRules))
    .max(remixRepairRules.length)
    .default([...remixRepairRules]),
  customInstruction: z.string().trim().max(2_000).default(""),
  preset: z.union([z.enum(remixModifyPresetIds), z.literal("")]).default(""),
  voiceMode: z.enum(remixVoiceModes).default(defaultRemixPromptToolConfig.voiceMode),
});
const RemixPromptToolRequestSchema = z.object({
  sourceJobId: z.string().uuid(),
  sourceAssetId: z.string().uuid(),
  prompt: z.string().trim().min(20).max(30_000),
  tool: z.enum(remixPromptTools),
  config: RemixPromptToolConfigSchema,
});
const RemixShotGenerationRequestSchema = z.object({
  sourceJobId: z.string().uuid(),
  sourceAssetId: z.string().uuid(),
  prompt: z.string().trim().min(20).max(30_000),
  modelId: VideoModelIdSchema,
  ratio: z.string().min(1).max(20),
  resolution: z.string().min(1).max(20),
  duration: z.number().int().min(4).max(15),
  referenceMode: z.string().min(1).max(40).default("omni"),
  referenceAssetIds: z.array(z.string().uuid()).max(2).default([]),
  generateAudio: z.boolean().default(true),
});
const RemixComposeRequestSchema = z.object({
  sourceJobId: z.string().uuid(),
  sources: z
    .array(
      z.object({
        sourceAssetId: z.string().uuid(),
        selectedAssetId: z.string().uuid(),
      }),
    )
    .min(2)
    .max(remixMaxSources),
});
const RemixPromptVersionSchema = z.object({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(40),
  prompt: z.string().max(30_000),
});
const RemixSourcePromptStateSchema = z.object({
  prompt: z.string().max(30_000),
  versions: z.array(RemixPromptVersionSchema).max(100),
  activeVersionId: z.string().max(120),
});
const RemixWorkspaceStateSchema = z.object({
  stage: z.number().int().min(0).max(4),
  promptStates: z.record(z.string().uuid(), RemixSourcePromptStateSchema),
  selectedShotAssets: z.record(z.string().uuid(), z.string().uuid()),
  composeOrder: z.array(z.string().uuid()).max(remixMaxSources),
  composePreviewId: z.union([z.string().uuid(), z.literal("")]),
});
const RemixProjectSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  productName: z.string(),
  currentStage: z.enum(remixProjectStages),
  status: JobStatusSchema,
  sourceCount: z.number().int().nonnegative(),
  generatedCount: z.number().int().nonnegative(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const RemixProjectUpdateSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  workspace: RemixWorkspaceStateSchema.optional(),
});

function remixProjectDetail(ownerUserId: string, root: JobRecord) {
  let rawProjectRequest: unknown = null;
  try {
    rawProjectRequest = JSON.parse(root.values.projectRequest || "null");
  } catch {
    rawProjectRequest = null;
  }
  const projectRequest = remixProjectRequestSchema.safeParse(rawProjectRequest);
  if (!projectRequest.success) return undefined;
  const children = store.listChildren(ownerUserId, root.id, "video-remix");
  const sources = parseRemixSources(root.values.sources);
  const sourceIds = sources.map((source) => source.assetId);
  const analysisEntries = parseRemixAnalysisEntries(root.values.analysisEntries);
  const workspace = parseRemixWorkspace(root.values.workspaceState, sourceIds, analysisEntries);
  const successfulShotJobs = children.filter(
    (job) => job.values.workflowPhase === "shot-generation" && job.status === "succeeded",
  );
  for (const sourceId of sourceIds) {
    const selectedId = workspace.selectedShotAssets[sourceId] ?? sourceId;
    if (selectedId === sourceId) continue;
    const valid = successfulShotJobs.some(
      (job) =>
        job.values.sourceAssetId === sourceId &&
        job.result?.artifacts.some((artifact) => artifact.id === selectedId && artifact.mimeType.startsWith("video/")),
    );
    if (!valid) workspace.selectedShotAssets[sourceId] = sourceId;
  }
  const referencedAssetIds = new Set([
    ...sourceIds,
    ...projectRequest.data.product.productImages.map((image) => image.metaId).filter((id): id is string => Boolean(id)),
    ...(projectRequest.data.voiceAsset?.objectKey ? [projectRequest.data.voiceAsset.objectKey] : []),
    ...Object.values(workspace.selectedShotAssets),
  ]);
  const missingAssetIds = [...referencedAssetIds].filter((assetId) => !accounts.getOwnedAsset(ownerUserId, assetId));
  const createdBy = accounts.getUser(ownerUserId)?.displayName || "当前用户";
  return {
    project: summarizeRemixProject(root, children, createdBy),
    rootJob: root,
    childJobs: children,
    projectRequest: projectRequest.data,
    workspace,
    missingAssetIds,
  };
}

const listRemixProjectsRoute = createRoute({
  method: "get",
  path: "/api/video-remix/projects",
  operationId: "listVideoRemixProjects",
  request: {
    query: z.object({
      query: z.string().trim().max(100).optional(),
      stage: z.enum(remixProjectStages).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(10),
    }),
  },
  responses: {
    200: {
      description: "Video remix projects",
      content: {
        "application/json": {
          schema: z.object({
            projects: z.array(RemixProjectSummarySchema),
            total: z.number().int().nonnegative(),
            page: z.number().int().min(1),
            pageSize: z.number().int().min(1),
          }),
        },
      },
    },
  },
});
app.openapi(listRemixProjectsRoute, (c) => {
  const ownerUserId = c.get("userId");
  const input = c.req.valid("query");
  const roots = store.listRemixProjectRoots(ownerUserId);
  const groupedChildren = groupRemixChildren(
    store.listChildrenForParents(
      ownerUserId,
      roots.map((root) => root.id),
    ),
  );
  const createdBy = accounts.getUser(ownerUserId)?.displayName || "当前用户";
  const keyword = input.query?.toLocaleLowerCase() ?? "";
  const summaries = roots
    .map((root) => summarizeRemixProject(root, groupedChildren.get(root.id) ?? [], createdBy))
    .filter(
      (project) =>
        (!keyword || `${project.title}\n${project.productName}`.toLocaleLowerCase().includes(keyword)) &&
        (!input.stage || project.currentStage === input.stage),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const offset = (input.page - 1) * input.pageSize;
  return c.json(
    {
      projects: summaries.slice(offset, offset + input.pageSize),
      total: summaries.length,
      page: input.page,
      pageSize: input.pageSize,
    },
    200,
  );
});

const RemixProjectDetailSchema = z.object({
  project: RemixProjectSummarySchema,
  rootJob: JobSchema,
  childJobs: z.array(JobSchema),
  projectRequest: remixProjectRequestSchema,
  workspace: RemixWorkspaceStateSchema,
  missingAssetIds: z.array(z.string().uuid()),
});
const getRemixProjectRoute = createRoute({
  method: "get",
  path: "/api/video-remix/projects/{projectId}",
  operationId: "getVideoRemixProject",
  request: { params: z.object({ projectId: z.string().uuid() }) },
  responses: {
    200: { description: "Video remix project", content: { "application/json": { schema: RemixProjectDetailSchema } } },
    404: { description: "Project not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Project cannot be restored", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(getRemixProjectRoute, (c) => {
  const ownerUserId = c.get("userId");
  const root = store.getOwned(c.req.valid("param").projectId, ownerUserId);
  if (root?.moduleId !== "video-remix" || root.parentJobId || root.values.workflowPhase !== "analysis")
    return c.json(
      {
        error: {
          code: "REMIX_PROJECT_NOT_FOUND",
          message: "项目不存在",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      404,
    );
  const detail = remixProjectDetail(ownerUserId, root);
  if (!detail)
    return c.json(
      {
        error: {
          code: "REMIX_PROJECT_STATE_INVALID",
          message: "项目初始数据不完整，无法继续创作",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  return c.json(detail, 200);
});

const updateRemixProjectRoute = createRoute({
  method: "patch",
  path: "/api/video-remix/projects/{projectId}",
  operationId: "updateVideoRemixProject",
  request: {
    params: z.object({ projectId: z.string().uuid() }),
    body: { required: true, content: { "application/json": { schema: RemixProjectUpdateSchema } } },
  },
  responses: {
    200: { description: "Updated video remix project", content: { "application/json": { schema: JobSchema } } },
    404: { description: "Project not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Project is not ready", content: { "application/json": { schema: ErrorSchema } } },
    422: { description: "Invalid project state", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(updateRemixProjectRoute, (c) => {
  const ownerUserId = c.get("userId");
  const root = store.getOwned(c.req.valid("param").projectId, ownerUserId);
  const requestId = crypto.randomUUID();
  if (root?.moduleId !== "video-remix" || root.parentJobId || root.values.workflowPhase !== "analysis")
    return c.json(
      { error: { code: "REMIX_PROJECT_NOT_FOUND", message: "项目不存在", retryable: false, requestId } },
      404,
    );
  const body = c.req.valid("json");
  if (body.title === undefined && body.workspace === undefined)
    return c.json(
      { error: { code: "EMPTY_PROJECT_UPDATE", message: "没有可保存的项目修改", retryable: false, requestId } },
      422,
    );
  if (body.workspace && root.status !== "succeeded" && root.status !== "partially_succeeded")
    return c.json(
      {
        error: {
          code: "REMIX_PROJECT_NOT_READY",
          message: "项目解析完成后才能保存创作状态",
          retryable: true,
          requestId,
        },
      },
      409,
    );
  if (body.workspace) {
    const sourceIds = parseRemixSources(root.values.sources).map((source) => source.assetId);
    const sourceSet = new Set(sourceIds);
    const selectedEntries = Object.entries(body.workspace.selectedShotAssets);
    const validOrder =
      body.workspace.composeOrder.length === sourceIds.length &&
      new Set(body.workspace.composeOrder).size === sourceIds.length &&
      body.workspace.composeOrder.every((sourceId) => sourceSet.has(sourceId));
    if (
      selectedEntries.length !== sourceIds.length ||
      selectedEntries.some(([sourceId]) => !sourceSet.has(sourceId)) ||
      Object.keys(body.workspace.promptStates).some((sourceId) => !sourceSet.has(sourceId)) ||
      !validOrder ||
      (body.workspace.composePreviewId && !sourceSet.has(body.workspace.composePreviewId))
    )
      return c.json(
        {
          error: {
            code: "INVALID_REMIX_WORKSPACE",
            message: "项目工作区与原始分镜不一致",
            retryable: false,
            requestId,
          },
        },
        422,
      );
    const shotJobs = store
      .listChildren(ownerUserId, root.id, "video-remix")
      .filter((job) => job.values.workflowPhase === "shot-generation" && job.status === "succeeded");
    const invalidSelection = selectedEntries.find(([sourceId, selectedId]) => {
      if (selectedId === sourceId) return false;
      return !shotJobs.some(
        (job) =>
          job.values.sourceAssetId === sourceId &&
          job.result?.artifacts.some(
            (artifact) => artifact.id === selectedId && artifact.mimeType.startsWith("video/"),
          ),
      );
    });
    if (invalidSelection)
      return c.json(
        {
          error: {
            code: "INVALID_REMIX_SELECTION",
            message: "选择的生成视频不属于对应原分镜",
            retryable: false,
            requestId,
          },
        },
        422,
      );
  }
  const title = body.title ?? root.title;
  const values = body.workspace ? { ...root.values, workspaceState: JSON.stringify(body.workspace) } : root.values;
  if (title === root.title && JSON.stringify(values) === JSON.stringify(root.values)) return c.json(root, 200);
  const updated = store.updateRemixProjectMetadata(root.id, { title, values });
  if (!updated) throw new Error("REMIX_PROJECT_UPDATE_FAILED");
  return c.json(updated, 200);
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
  const voiceAssetId = parsed.data.voiceAsset?.objectKey;
  const assets = [...productAssetIds, ...videoAssetIds, ...(voiceAssetId ? [voiceAssetId] : [])].map((id) =>
    accounts.getOwnedAsset(ownerUserId, id),
  );
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
  if (
    assets
      .slice(productAssetIds.length, productAssetIds.length + videoAssetIds.length)
      .some((asset) => !asset?.mimeType.startsWith("video/"))
  )
    return c.json(
      { error: { code: "INVALID_VIDEO_ASSET", message: "分镜素材必须全部为视频", retryable: false, requestId } },
      422,
    );
  const voiceAsset = voiceAssetId ? assets.at(-1) : undefined;
  if (voiceAssetId && !voiceAsset?.mimeType.startsWith("audio/"))
    return c.json(
      { error: { code: "INVALID_VOICE_ASSET", message: "音色素材必须是当前账号的音频", retryable: false, requestId } },
      422,
    );
  const productAsset = assets[0];
  const videoAssets = assets.slice(productAssetIds.length, productAssetIds.length + videoAssetIds.length);
  if (!productAsset || videoAssets.some((asset) => !asset))
    return c.json(
      { error: { code: "ASSET_NOT_AVAILABLE", message: "引用的商品或视频素材不存在", retryable: false, requestId } },
      422,
    );
  const portraitReference = parsed.data.portraitAssets[0]?.reference;
  if (
    portraitReference &&
    !resolvePortraitReference({ ownerUserId, reference: portraitReference, accounts, customPortraits })
  )
    return c.json(
      {
        error: {
          code: "PORTRAIT_NOT_AVAILABLE",
          message: "所选人像不存在或尚未就绪",
          retryable: false,
          requestId,
        },
      },
      422,
    );
  const values = {
    workflowPhase: "analysis",
    source: `asset:${videoAssets[0]?.id}:${videoAssets[0]?.originalName}`,
    sources: JSON.stringify(
      videoAssets.map((asset) => ({ assetId: asset?.id || "", name: asset?.originalName || "source.mp4" })),
    ),
    product: `asset:${productAsset.id}:${parsed.data.product.productName}`,
    productName: parsed.data.product.productName,
    productImageAssetIds: JSON.stringify(productAssetIds),
    description: parsed.data.demand,
    prompt: parsed.data.demand,
    portrait: parsed.data.portraitAssets[0]?.assetName ?? "",
    ...(portraitReference ? { portraitReference: serializePortraitReference(portraitReference)! } : {}),
    voiceAssetId: voiceAssetId ?? "",
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
        id: "plan:1:video-understand",
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

const remixPromptToolRoute = createRoute({
  method: "post",
  path: "/api/video-remix/prompt-tools",
  operationId: "createVideoRemixPromptToolJob",
  request: {
    body: { required: true, content: { "application/json": { schema: RemixPromptToolRequestSchema } } },
  },
  responses: {
    202: { description: "Prompt tool job accepted", content: { "application/json": { schema: JobSchema } } },
    404: { description: "Source analysis not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Source analysis is not ready", content: { "application/json": { schema: ErrorSchema } } },
    422: { description: "Invalid prompt tool request", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(remixPromptToolRoute, async (c) => {
  const ownerUserId = c.get("userId");
  const body = c.req.valid("json");
  const requestId = crypto.randomUUID();
  const sourceJob = store.getOwned(body.sourceJobId, ownerUserId);
  if (sourceJob?.moduleId !== "video-remix")
    return c.json(
      { error: { code: "REMIX_SOURCE_NOT_FOUND", message: "原始解析任务不存在", retryable: false, requestId } },
      404,
    );
  if (sourceJob.status !== "succeeded" && sourceJob.status !== "partially_succeeded")
    return c.json(
      { error: { code: "REMIX_SOURCE_NOT_READY", message: "原始解析任务尚未完成", retryable: true, requestId } },
      409,
    );
  const sourceIds = new Set(parseRemixSources(sourceJob.values.sources).map((source) => source.assetId));
  if (!sourceIds.has(body.sourceAssetId))
    return c.json(
      { error: { code: "REMIX_SOURCE_NOT_FOUND", message: "当前分镜视频不属于解析任务", retryable: false, requestId } },
      404,
    );
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim().slice(0, 128);
  if (idempotencyKey) {
    const existing = store.getByIdempotencyKey(ownerUserId, idempotencyKey);
    if (existing) return c.json(existing, 202);
  }
  const timestamp = new Date().toISOString();
  const job: JobRecord = {
    id: crypto.randomUUID(),
    ownerUserId,
    moduleId: "video-remix",
    title: `爆款二创 · ${remixPromptToolLabels[body.tool]}`,
    status: "queued",
    progress: 0,
    stage: "排队中",
    overallExecutionMode: "real",
    values: {
      workflowPhase: "prompt-rewrite",
      sourceJobId: sourceJob.id,
      sourceAssetId: body.sourceAssetId,
      promptTool: body.tool,
      promptToolConfig: JSON.stringify(body.config),
      originalPrompt: body.prompt,
    },
    executionPlan: [
      {
        id: "plan:0:text-rewrite",
        capability: "text-rewrite",
        executionMode: "real",
        implementation: "aihubmix-chat-completions",
        provider: "aihubmix",
        model: "deepseek-v4-pro",
        startedAt: "",
      },
    ],
    provenance: [],
    parentJobId: sourceJob.id,
    idempotencyKey,
    cancelRequested: false,
    providerCancelState: "none",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  store.create(job);
  await queue.enqueue(job.id);
  return c.json(job, 202);
});

const remixShotGenerationRoute = createRoute({
  method: "post",
  path: "/api/video-remix/project/shots/generate",
  operationId: "createVideoRemixShotGenerationJob",
  request: {
    body: { required: true, content: { "application/json": { schema: RemixShotGenerationRequestSchema } } },
  },
  responses: {
    202: { description: "Shot generation job accepted", content: { "application/json": { schema: JobSchema } } },
    404: { description: "Source analysis not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Source analysis is not ready", content: { "application/json": { schema: ErrorSchema } } },
    422: { description: "Invalid shot generation input", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(remixShotGenerationRoute, async (c) => {
  const ownerUserId = c.get("userId");
  const body = c.req.valid("json");
  const requestId = crypto.randomUUID();
  const sourceJob = store.getOwned(body.sourceJobId, ownerUserId);
  if (sourceJob?.moduleId !== "video-remix" || sourceJob.values.workflowPhase !== "analysis")
    return c.json(
      { error: { code: "REMIX_SOURCE_NOT_FOUND", message: "原始解析任务不存在", retryable: false, requestId } },
      404,
    );
  if (sourceJob.status !== "succeeded" && sourceJob.status !== "partially_succeeded")
    return c.json(
      { error: { code: "REMIX_SOURCE_NOT_READY", message: "原始解析任务尚未完成", retryable: true, requestId } },
      409,
    );
  const sourceIds = new Set(parseRemixSources(sourceJob.values.sources).map((source) => source.assetId));
  if (!sourceIds.has(body.sourceAssetId))
    return c.json(
      { error: { code: "REMIX_SOURCE_NOT_FOUND", message: "当前分镜不属于解析任务", retryable: false, requestId } },
      404,
    );
  const sourceAsset = accounts.getOwnedAsset(ownerUserId, body.sourceAssetId);
  if (!sourceAsset?.mimeType.startsWith("video/"))
    return c.json(
      { error: { code: "INVALID_VIDEO_ASSET", message: "原分镜素材不存在或不是视频", retryable: false, requestId } },
      422,
    );
  if (!ossutils.configured)
    return c.json(
      {
        error: {
          code: "TOS_NOT_CONFIGURED",
          message: "分镜生成结果需要保存到素材库，请先配置 TOS",
          retryable: false,
          requestId,
        },
      },
      422,
    );
  const referenceIds = [...new Set(body.referenceAssetIds)].filter((assetId) => assetId !== body.sourceAssetId);
  if (referenceIds.length !== body.referenceAssetIds.length)
    return c.json(
      { error: { code: "INVALID_REFERENCE_ASSETS", message: "参考素材不能重复", retryable: false, requestId } },
      422,
    );
  const referenceAssets = referenceIds.map((assetId) => accounts.getOwnedAsset(ownerUserId, assetId));
  if (
    referenceAssets.some(
      (asset) => !asset || (!asset.mimeType.startsWith("image/") && !asset.mimeType.startsWith("audio/")),
    )
  )
    return c.json(
      {
        error: {
          code: "INVALID_REFERENCE_ASSETS",
          message: "额外参考素材仅支持当前账号的图片或音频",
          retryable: false,
          requestId,
        },
      },
      422,
    );
  const referenceKinds = referenceAssets.map((asset) => (asset?.mimeType.startsWith("image/") ? "image" : "audio"));
  if (new Set(referenceKinds).size !== referenceKinds.length)
    return c.json(
      { error: { code: "INVALID_REFERENCE_ASSETS", message: "每类额外参考素材最多一个", retryable: false, requestId } },
      422,
    );
  const creationValues = {
    type: "视频",
    creationKind: "video",
    prompt: body.prompt,
    modelId: body.modelId,
    ratio: body.ratio,
    resolution: body.resolution,
    count: "1",
    seed: "",
    referenceMode: body.referenceMode,
    duration: String(body.duration),
  };
  const providers = getCreationProviderStatus();
  const models = creationCapabilities(providers.imageEnabled, providers.videoEnabled);
  const validationError = validateCreationValues(creationValues, models);
  if (validationError)
    return c.json(
      { error: { code: "INVALID_CREATION_CONFIG", message: validationError, retryable: false, requestId } },
      422,
    );
  if (!videoModelEnabled(body.modelId))
    return c.json(
      { error: { code: "VIDEO_MODEL_NOT_VERIFIED", message: "该视频模型尚未通过验证", retryable: false, requestId } },
      422,
    );
  const quote = quoteCreation(creationValues, models);
  const user = accounts.getUser(ownerUserId);
  if (!user || user.credits < quote)
    return c.json(
      {
        error: {
          code: "INSUFFICIENT_CREDITS",
          message: `本次预计消耗 ${quote} 创作点，当前余额不足`,
          retryable: false,
          requestId,
        },
      },
      422,
    );
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim().slice(0, 128);
  if (idempotencyKey) {
    const existing = store.getByIdempotencyKey(ownerUserId, idempotencyKey);
    if (existing) return c.json(existing, 202);
  }
  const timestamp = new Date().toISOString();
  const references = [sourceAsset, ...referenceAssets].filter((asset) => asset !== undefined);
  const job: JobRecord = {
    id: crypto.randomUUID(),
    ownerUserId,
    moduleId: "video-remix",
    title: `${sourceJob.title} · ${sourceAsset.originalName} · 视频生成`,
    status: "queued",
    progress: 0,
    stage: "排队中",
    overallExecutionMode: "real",
    values: {
      ...creationValues,
      workflowPhase: "shot-generation",
      sourceJobId: sourceJob.id,
      sourceAssetId: sourceAsset.id,
      references: `assets:${JSON.stringify(
        references.map((asset) => ({ id: asset.id, name: asset.originalName, mimeType: asset.mimeType })),
      )}`,
      referenceAssetIds: JSON.stringify(referenceIds),
      generateAudio: String(body.generateAudio),
      ...(sourceJob.values.portraitReference ? { portraitReference: sourceJob.values.portraitReference } : {}),
      outputFolderId: accounts.getDefaultAssetFolderId(ownerUserId),
    },
    videoModel: body.modelId,
    executionPlan: [],
    provenance: [],
    parentJobId: sourceJob.id,
    idempotencyKey,
    cancelRequested: false,
    providerCancelState: "none",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  try {
    store.createCharged(job, quote);
  } catch (error) {
    if (error instanceof InsufficientCreditsError)
      return c.json(
        {
          error: {
            code: "INSUFFICIENT_CREDITS",
            message: "创作点余额发生变化，请刷新后重试",
            retryable: false,
            requestId,
          },
        },
        422,
      );
    throw error;
  }
  await queue.enqueue(job.id);
  return c.json(job, 202);
});

const remixShotJobsRoute = createRoute({
  method: "get",
  path: "/api/video-remix/project/{sourceJobId}/shots",
  operationId: "listVideoRemixShotGenerationJobs",
  request: { params: z.object({ sourceJobId: z.string().uuid() }) },
  responses: {
    200: {
      description: "Shot generation history",
      content: { "application/json": { schema: z.object({ jobs: z.array(JobSchema) }) } },
    },
    404: { description: "Source analysis not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(remixShotJobsRoute, (c) => {
  const ownerUserId = c.get("userId");
  const sourceJobId = c.req.valid("param").sourceJobId;
  const sourceJob = store.getOwned(sourceJobId, ownerUserId);
  if (sourceJob?.moduleId !== "video-remix" || sourceJob.values.workflowPhase !== "analysis")
    return c.json(
      {
        error: {
          code: "REMIX_SOURCE_NOT_FOUND",
          message: "原始解析任务不存在",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      404,
    );
  const jobs = store
    .listChildren(ownerUserId, sourceJob.id, "video-remix")
    .filter((job) => job.values.workflowPhase === "shot-generation");
  return c.json({ jobs }, 200);
});

const remixComposeRoute = createRoute({
  method: "post",
  path: "/api/video-remix/project/compose",
  operationId: "createVideoRemixComposeJob",
  request: {
    body: { required: true, content: { "application/json": { schema: RemixComposeRequestSchema } } },
  },
  responses: {
    202: { description: "Video compose job accepted", content: { "application/json": { schema: JobSchema } } },
    404: { description: "Source analysis not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Source analysis is not ready", content: { "application/json": { schema: ErrorSchema } } },
    422: { description: "Invalid ordered sources", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(remixComposeRoute, async (c) => {
  const ownerUserId = c.get("userId");
  const body = c.req.valid("json");
  const requestId = crypto.randomUUID();
  const sourceJob = store.getOwned(body.sourceJobId, ownerUserId);
  if (sourceJob?.moduleId !== "video-remix" || sourceJob.values.workflowPhase !== "analysis")
    return c.json(
      { error: { code: "REMIX_SOURCE_NOT_FOUND", message: "原始解析任务不存在", retryable: false, requestId } },
      404,
    );
  if (sourceJob.status !== "succeeded" && sourceJob.status !== "partially_succeeded")
    return c.json(
      { error: { code: "REMIX_SOURCE_NOT_READY", message: "原始解析任务尚未完成", retryable: true, requestId } },
      409,
    );
  const sources = parseRemixSources(sourceJob.values.sources);
  const allowedIds = new Set(sources.map((source) => source.assetId));
  const composeSources = body.sources;
  const sourceIds = composeSources.map((source) => source.sourceAssetId);
  if (new Set(sourceIds).size !== sourceIds.length || composeSources.length !== sources.length)
    return c.json(
      {
        error: {
          code: "INVALID_REMIX_ORDER",
          message: "合并顺序必须包含全部视频且不能重复",
          retryable: false,
          requestId,
        },
      },
      422,
    );
  if (sourceIds.some((assetId) => !allowedIds.has(assetId)))
    return c.json(
      { error: { code: "INVALID_REMIX_ORDER", message: "合并顺序包含无效视频", retryable: false, requestId } },
      422,
    );
  const shotJobs = store
    .listChildren(ownerUserId, sourceJob.id, "video-remix")
    .filter((job) => job.values.workflowPhase === "shot-generation" && job.status === "succeeded");
  const invalidSelection = composeSources.find(({ sourceAssetId, selectedAssetId }) => {
    if (selectedAssetId === sourceAssetId) return false;
    return !shotJobs.some(
      (job) =>
        job.values.sourceAssetId === sourceAssetId &&
        job.result?.artifacts.some(
          (artifact) => artifact.id === selectedAssetId && artifact.mimeType.startsWith("video/") && artifact.url,
        ),
    );
  });
  if (invalidSelection)
    return c.json(
      {
        error: {
          code: "INVALID_REMIX_SELECTION",
          message: "选择的生成视频不属于对应原分镜",
          retryable: false,
          requestId,
        },
      },
      422,
    );
  const orderedIds = composeSources.map((source) => source.selectedAssetId);
  const assets = orderedIds.map((assetId) => accounts.getOwnedAsset(ownerUserId, assetId));
  if (assets.some((asset) => !asset?.mimeType.startsWith("video/")))
    return c.json(
      { error: { code: "INVALID_VIDEO_ASSET", message: "合并素材不存在或不是视频", retryable: false, requestId } },
      422,
    );
  const idempotencyKey = c.req.header("Idempotency-Key")?.trim().slice(0, 128);
  if (idempotencyKey) {
    const existing = store.getByIdempotencyKey(ownerUserId, idempotencyKey);
    if (existing) return c.json(existing, 202);
  }
  const timestamp = new Date().toISOString();
  const job: JobRecord = {
    id: crypto.randomUUID(),
    ownerUserId,
    moduleId: "video-remix",
    title: `${sourceJob.title} · 合并成片`,
    status: "queued",
    progress: 0,
    stage: "排队中",
    overallExecutionMode: "local",
    values: {
      workflowPhase: "compose",
      sourceJobId: sourceJob.id,
      composeSources: JSON.stringify(composeSources),
      orderedAssetIds: JSON.stringify(orderedIds),
      outputFolderId: accounts.getDefaultAssetFolderId(ownerUserId),
    },
    executionPlan: [
      {
        id: "plan:0:normalize",
        capability: "video-normalize",
        executionMode: "local",
        implementation: "ffmpeg-local",
        startedAt: "",
      },
      {
        id: "plan:1:concat",
        capability: "video-concat",
        executionMode: "local",
        implementation: "ffmpeg-concat",
        startedAt: "",
      },
    ],
    provenance: [],
    parentJobId: sourceJob.id,
    idempotencyKey,
    cancelRequested: false,
    providerCancelState: "none",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  store.create(job);
  await queue.enqueue(job.id);
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
  const local = operation === "compose" || operation === "audio-replace" || operation === "subtitle-compose";
  return {
    id: crypto.randomUUID(),
    ownerUserId: input.ownerUserId,
    moduleId: "video-create",
    title: input.title,
    status: "queued",
    progress: 0,
    stage: "排队中",
    overallExecutionMode: local ? "local" : "real",
    values: input.values,
    videoModel: input.videoModel,
    executionPlan: [
      {
        id: `plan:0:${operation}`,
        capability: operation,
        executionMode: local ? "local" : "real",
        implementation: local
          ? operation === "audio-replace"
            ? "ffmpeg-audio-replace"
            : operation === "subtitle-compose"
              ? "ffmpeg-subtitle"
              : "ffmpeg-concat"
          : operation === "analyze"
            ? "aihubmix-gpt-image-analysis"
            : operation === "shot"
              ? "ark-seedance-video"
              : operation === "audio-generate"
                ? "volc-tts-v3-unidirectional"
                : "aihubmix-text",
        provider: local
          ? undefined
          : operation === "shot"
            ? "ark"
            : operation === "audio-generate"
              ? "volc-speech"
              : "aihubmix",
        model:
          operation === "analyze"
            ? VIDEO_CREATE_ANALYSIS_MODEL
            : operation === "shot"
              ? input.videoModel
              : operation === "audio-generate"
                ? env.volcSpeech.presetTtsResourceId
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
  const portraitReference = normalizePortraitReference(input.portraitReference, input.portraitId);
  if (
    portraitReference &&
    !resolvePortraitReference({ ownerUserId, reference: portraitReference, accounts, customPortraits })
  )
    return false;
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

const clearVideoCreateScriptRoute = createRoute({
  method: "delete",
  path: "/api/video-create/projects/{projectId}/script",
  operationId: "clearVideoCreateScript",
  request: { params: z.object({ projectId: z.string().uuid() }) },
  responses: {
    200: { description: "Script cleared", content: { "application/json": { schema: VideoCreateProjectSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Project is busy", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(clearVideoCreateScriptRoute, (c) => {
  try {
    const project = videoCreates.clearScripts(c.req.valid("param").projectId, c.get("userId"));
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
    if (error instanceof VideoCreateStateError)
      return c.json(
        {
          error: {
            code: "ACTION_IN_PROGRESS",
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
  operation:
    | "analyze"
    | "script"
    | "regenerate-section"
    | "storyboard"
    | "shot"
    | "audio-generate"
    | "audio-replace"
    | "subtitle-compose"
    | "compose";
  idempotencyKey?: string;
  sectionId?: string;
  shotId?: string;
  expectedVersionId?: string;
  shotOptions?: {
    videoModel: JobRecord["videoModel"];
    ratio: "9:16" | "16:9" | "1:1";
    resolution: "480p" | "720p";
    generateAudio: boolean;
    prompt?: string;
    duration?: number;
    referenceMode?: "omni";
    references?: Array<{ assetId: string; label: string; category?: "人物" | "商品" }>;
    portrait?: { reference: PortraitReference; label: string; category: "人物" } | null;
  };
}) {
  if (input.idempotencyKey) {
    const existing = store.getByIdempotencyKey(input.ownerUserId, input.idempotencyKey);
    if (existing) return existing;
  }
  const aggregate = videoCreates.getOwned(input.projectId, input.ownerUserId);
  if (!aggregate) throw new VideoCreateStateError("一键成片项目不存在");
  const shot = input.shotId ? aggregate.shots.find((item) => item.id === input.shotId) : undefined;
  if (shot && (shot.status === "queued" || shot.status === "generating" || shot.materialProcessing))
    throw new VideoCreateMaterialBusyError("该分镜正在处理中");
  const referenceId = aggregate.project.input.productAssetIds[0];
  const explicitReferences = input.shotOptions?.references;
  const explicitPortrait = input.shotOptions?.portrait;
  const materialInputVersionId =
    shot?.currentMaterialVersionId && input.operation === "subtitle-compose"
      ? (videoCreates.getSubtitleSourceMaterialVersion(input.projectId, shot.id, shot.currentMaterialVersionId)?.id ??
        shot.currentMaterialVersionId)
      : shot?.currentMaterialVersionId;
  const values = {
    ...videoCreateJobValues(input),
    ...(shot
      ? {
          previousShotStatus: shot.status,
          ...(materialInputVersionId ? { inputMaterialVersionId: materialInputVersionId } : {}),
          ...(shot.currentMaterialVersionId && materialInputVersionId !== shot.currentMaterialVersionId
            ? { expectedCurrentMaterialVersionId: shot.currentMaterialVersionId }
            : {}),
        }
      : {}),
    ...(shot
      ? {
          prompt: input.shotOptions?.prompt ?? shot.prompt,
          durationSec: String(input.shotOptions?.duration ?? shot.durationSec),
          ratio: input.shotOptions?.ratio ?? aggregate.project.input.ratio,
          resolution: input.shotOptions?.resolution ?? "720p",
          generateAudio: String(input.shotOptions?.generateAudio ?? shot.audioEnabled),
          subtitleEnabled: String(shot.subtitleEnabled),
          voicePresetId: aggregate.project.input.voiceSettings.presetVoiceId,
          voiceSpeed: aggregate.project.input.voiceSettings.speed,
          voiceStyle: aggregate.project.input.voiceSettings.style,
          voiceSettingsKey: videoCreateVoiceSettingsKey(aggregate.project.input.voiceSettings),
          subtitleStyleId: aggregate.project.input.subtitleStyleId,
          ...(input.shotOptions?.referenceMode ? { referenceMode: input.shotOptions.referenceMode } : {}),
          ...(explicitReferences
            ? {
                references: `assets:${JSON.stringify(
                  explicitReferences.map((reference) => ({ id: reference.assetId, label: reference.label })),
                )}`,
              }
            : aggregate.project.input.voiceAssetId
              ? { voiceReference: `asset:${aggregate.project.input.voiceAssetId}:voice` }
              : {}),
          ...(explicitPortrait !== undefined
            ? explicitPortrait
              ? {
                  portraitReference: serializePortraitReference(explicitPortrait.reference)!,
                  portraitLabel: explicitPortrait.label,
                }
              : {}
            : normalizePortraitReference(aggregate.project.input.portraitReference, aggregate.project.input.portraitId)
              ? {
                  portraitReference: serializePortraitReference(
                    normalizePortraitReference(
                      aggregate.project.input.portraitReference,
                      aggregate.project.input.portraitId,
                    ),
                  )!,
                }
              : explicitReferences === undefined && referenceId
                ? { reference: `asset:${referenceId}:reference` }
                : {}),
        }
      : {}),
  };
  const job = videoCreateJobRecord({
    ownerUserId: input.ownerUserId,
    title: `${aggregate.project.title} · ${input.operation}`,
    values,
    idempotencyKey: input.idempotencyKey,
    videoModel:
      input.operation === "shot" ? (input.shotOptions?.videoModel ?? aggregate.project.input.videoModel) : undefined,
  });
  store.create(job);
  if (shot && input.operation !== "audio-generate") {
    const source =
      input.operation === "audio-replace"
        ? "audio_replaced"
        : input.operation === "subtitle-compose"
          ? "subtitle_composed"
          : "ai_generated";
    videoCreates.createPendingMaterialVersion({
      projectId: input.projectId,
      shotId: shot.id,
      source,
      inputVersionId: materialInputVersionId,
      jobId: job.id,
      subtitlesComposed:
        input.operation === "subtitle-compose"
          ? true
          : input.operation === "audio-replace" && shot.currentMaterialVersionId
            ? (videoCreates.getMaterialVersion(input.projectId, shot.id, shot.currentMaterialVersionId)
                ?.subtitlesComposed ?? false)
            : false,
      subtitleStyleId:
        input.operation === "subtitle-compose"
          ? aggregate.project.input.subtitleStyleId
          : input.operation === "audio-replace" && shot.currentMaterialVersionId
            ? (videoCreates.getMaterialVersion(input.projectId, shot.id, shot.currentMaterialVersionId)
                ?.subtitleStyleId ?? null)
            : input.operation === "shot" && shot.subtitleEnabled
              ? aggregate.project.input.subtitleStyleId
              : null,
    });
    videoCreates.updateShot(shot.id, {
      ...(input.operation === "shot" && !shot.currentMaterialVersionId ? { status: "queued" as const } : {}),
      ...(input.operation === "shot" && input.shotOptions ? { audioEnabled: !input.shotOptions.generateAudio } : {}),
      jobId: job.id,
      error: null,
    });
  } else if (shot) {
    videoCreates.updateShot(shot.id, {
      status: "queued",
      ...(input.operation === "audio-generate" ? { audioEnabled: true } : {}),
      jobId: job.id,
      error: null,
    });
  } else
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
  if (
    action === "storyboard" &&
    aggregate.project.input.segmentCount < videoCreateMinimumStoryboardCount(aggregate.project.input.durationSec)
  )
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

const VideoCreateShotGenerationOptionsSchema = z.object({
  videoModel: VideoModelIdSchema,
  ratio: z.enum(["9:16", "16:9", "1:1"]),
  resolution: z.enum(["480p", "720p"]),
  generateAudio: z.boolean(),
});

const VideoCreateShotGenerationReferenceInputSchema = z.object({
  assetId: z.string().uuid(),
  label: z.string().trim().min(1).max(20),
  category: z.enum(["人物", "商品"]).optional(),
});
const VideoCreateShotGenerationPortraitInputSchema = z.object({
  reference: z.discriminatedUnion("type", [
    z.object({ type: z.literal("general"), portraitId: z.number().int().min(1) }),
    z.object({ type: z.literal("custom"), assetId: z.string().uuid() }),
  ]),
  label: z.string().trim().min(1).max(20),
  category: z.literal("人物"),
});
const VideoCreateShotGenerationSubmitSchema = VideoCreateShotGenerationOptionsSchema.extend({
  prompt: z.string().trim().min(20).max(10_000),
  duration: z.number().int().min(4).max(15),
  referenceMode: z.literal("omni"),
  references: z.array(VideoCreateShotGenerationReferenceInputSchema).max(12),
  usePortrait: z.boolean(),
  portrait: VideoCreateShotGenerationPortraitInputSchema.optional(),
});
const VideoCreateShotGenerationAttachmentSchema = z.object({
  source: z.enum(["asset", "portrait"]),
  assetId: z.string().uuid().optional(),
  portraitReference: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("general"), portraitId: z.number().int().min(1) }),
      z.object({ type: z.literal("custom"), assetId: z.string().uuid() }),
    ])
    .optional(),
  /** @deprecated Legacy draft compatibility. */
  portraitId: z.number().int().min(1).optional(),
  label: z.string(),
  name: z.string(),
  mimeType: z.string(),
  role: z.enum(["reference_image", "reference_video", "reference_audio"]),
  category: z.enum(["人物", "商品"]).optional(),
  url: z.string(),
});
const VideoCreateShotGenerationDraftSchema = z.object({
  shotId: z.string().uuid(),
  ordinal: z.number().int().min(1),
  narration: z.string(),
  duration: z.number().int().min(4).max(15),
  prompt: z.string(),
  generationPlan: VideoCreateShotGenerationPlanSchema,
  referenceMode: z.literal("omni"),
  attachments: z.array(VideoCreateShotGenerationAttachmentSchema),
  executionMode: z.enum(["real", "mock"]),
  postProcessAudio: z.object({
    model: z.literal("tts-1"),
    voice: z.literal("alloy"),
    replacesNativeAudio: z.boolean(),
  }),
});

function getVideoCreateShotGenerationDraft(projectId: string, shotId: string, ownerUserId: string) {
  const aggregate = videoCreates.getOwned(projectId, ownerUserId);
  const shot = aggregate?.shots.find((item) => item.id === shotId);
  const narration = aggregate && shot ? videoCreateShotNarration(aggregate, shot) : "";
  if (!aggregate || !shot || !narration) return undefined;
  const attachments: Array<z.infer<typeof VideoCreateShotGenerationAttachmentSchema>> = [];
  const labels: string[] = [];
  const projectPortraitReference = normalizePortraitReference(
    aggregate.project.input.portraitReference,
    aggregate.project.input.portraitId,
  );
  const portrait = projectPortraitReference
    ? resolvePortraitReference({ ownerUserId, reference: projectPortraitReference, accounts, customPortraits })
    : undefined;
  if (portrait) {
    const label = nextVideoCreateReferenceLabel("image", labels);
    labels.push(label);
    attachments.push({
      source: "portrait",
      portraitReference: projectPortraitReference,
      label,
      name: portrait.name,
      mimeType: portrait.mimeType,
      role: "reference_image",
      category: "人物",
      url: portrait.imageUrl,
    });
  }
  for (const productId of aggregate.project.input.productAssetIds) {
    const product = accounts.getOwnedAsset(ownerUserId, productId);
    if (!product?.mimeType.startsWith("image/")) continue;
    const label = nextVideoCreateReferenceLabel("image", labels);
    labels.push(label);
    attachments.push({
      source: "asset",
      assetId: product.id,
      label,
      name: product.displayName,
      mimeType: product.mimeType,
      role: videoCreateReferenceRole("image"),
      category: "商品",
      url: `/api/assets/${product.id}/content`,
    });
  }
  const voiceId = aggregate.project.input.voiceAssetId;
  const voice = voiceId ? accounts.getOwnedAsset(ownerUserId, voiceId) : undefined;
  if (voice?.mimeType.startsWith("audio/")) {
    const label = nextVideoCreateReferenceLabel("audio", labels);
    labels.push(label);
    attachments.push({
      source: "asset",
      assetId: voice.id,
      label,
      name: voice.displayName,
      mimeType: voice.mimeType,
      role: videoCreateReferenceRole("audio"),
      url: `/api/assets/${voice.id}/content`,
    });
  }
  const duration = Math.min(15, Math.max(4, Math.round(shot.durationSec)));
  const generationPlan = fitVideoCreateShotPlanDuration(
    shot.generationPlan ??
      createFallbackVideoCreateShotPlan({ durationSec: duration, shotPrompt: shot.prompt, narration }),
    duration,
  );
  return {
    shotId: shot.id,
    ordinal: shot.ordinal,
    narration,
    duration,
    generationPlan,
    prompt: buildVideoCreateShotGenerationPrompt({
      durationSec: duration,
      plan: generationPlan,
      references: attachments.map(({ label, name, role, category }) => ({ label, name, role, category })),
    }),
    referenceMode: "omni" as const,
    attachments,
    executionMode: "real" as const,
    postProcessAudio: { model: "tts-1" as const, voice: "alloy" as const, replacesNativeAudio: shot.audioEnabled },
  };
}

const getVideoCreateShotGenerationDraftRoute = createRoute({
  method: "get",
  path: "/api/video-create/projects/{projectId}/shots/{shotId}/generation-draft",
  operationId: "getVideoCreateShotGenerationDraft",
  request: { params: z.object({ projectId: z.string().uuid(), shotId: z.string().uuid() }) },
  responses: {
    200: {
      description: "Resolved shot generation draft",
      content: { "application/json": { schema: VideoCreateShotGenerationDraftSchema } },
    },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(getVideoCreateShotGenerationDraftRoute, (c) => {
  const { projectId, shotId } = c.req.valid("param");
  const draft = getVideoCreateShotGenerationDraft(projectId, shotId, c.get("userId"));
  return draft
    ? c.json(draft, 200)
    : c.json(
        {
          error: { code: "NOT_FOUND", message: "分镜生成草稿不存在", retryable: false, requestId: crypto.randomUUID() },
        },
        404,
      );
});

const generateVideoCreateShotRoute = createRoute({
  method: "post",
  path: "/api/video-create/projects/{projectId}/shots/{shotId}/generate",
  operationId: "generateVideoCreateShot",
  request: {
    params: z.object({ projectId: z.string().uuid(), shotId: z.string().uuid() }),
    body: { required: true, content: { "application/json": { schema: VideoCreateShotGenerationSubmitSchema } } },
  },
  responses: {
    202: { description: "Accepted", content: { "application/json": { schema: JobSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Already generating", content: { "application/json": { schema: ErrorSchema } } },
    422: { description: "Model unavailable", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(generateVideoCreateShotRoute, async (c) => {
  const { projectId, shotId } = c.req.valid("param");
  const options = c.req.valid("json");
  const shot = videoCreates.getOwnedShot(projectId, shotId, c.get("userId"));
  if (!shot)
    return c.json(
      { error: { code: "NOT_FOUND", message: "分镜不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  if (shot.status === "queued" || shot.status === "generating" || shot.materialProcessing)
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
  if (!videoModelEnabled(options.videoModel))
    return c.json(
      {
        error: {
          code: "VIDEO_MODEL_UNAVAILABLE",
          message: "所选视频模型当前不可用",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      422,
    );
  const references = options.references.map((reference) => ({
    ...reference,
    asset: accounts.getOwnedAsset(c.get("userId"), reference.assetId),
  }));
  const missing = references.find((reference) => !reference.asset);
  const portrait =
    options.usePortrait && options.portrait
      ? resolvePortraitReference({
          ownerUserId: c.get("userId"),
          reference: options.portrait.reference,
          accounts,
          customPortraits,
        })
      : undefined;
  if (missing || (options.usePortrait && !portrait))
    return c.json(
      {
        error: {
          code: "REFERENCE_NOT_AVAILABLE",
          message: "参考素材不存在或不属于当前账号",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      422,
    );
  const referenceError = validateVideoCreateShotGenerationReferences({
    prompt: options.prompt,
    references: references.map((reference) => ({
      id: reference.assetId,
      label: reference.label,
      mimeType: reference.asset?.mimeType ?? "",
      byteSize: reference.asset?.byteSize ?? 0,
      category: reference.category,
    })),
    portraitLabel: options.usePortrait ? options.portrait?.label : undefined,
    portraitCategory: options.usePortrait ? options.portrait?.category : undefined,
  });
  if (referenceError)
    return c.json(
      {
        error: {
          code: "INVALID_VIDEO_REFERENCES",
          message: referenceError,
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      422,
    );
  const { usePortrait: _usePortrait, ...shotOptions } = options;
  const job = await enqueueVideoCreateOperation({
    ownerUserId: c.get("userId"),
    projectId,
    operation: "shot",
    shotId,
    shotOptions: { ...shotOptions, portrait: options.usePortrait && options.portrait ? options.portrait : null },
    idempotencyKey: c.req.header("Idempotency-Key")?.trim().slice(0, 128),
  });
  return c.json(job, 202);
});

const batchGenerateVideoCreateShotsRoute = createRoute({
  method: "post",
  path: "/api/video-create/projects/{projectId}/shots/batch-generate",
  operationId: "batchGenerateVideoCreateShots",
  request: {
    params: z.object({ projectId: z.string().uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: VideoCreateShotGenerationOptionsSchema,
        },
      },
    },
  },
  responses: {
    202: {
      description: "Accepted",
      content: {
        "application/json": {
          schema: z.object({ jobs: z.array(JobSchema), submittedShotIds: z.array(z.string().uuid()) }),
        },
      },
    },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Nothing to generate", content: { "application/json": { schema: ErrorSchema } } },
    422: { description: "Model unavailable", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(batchGenerateVideoCreateShotsRoute, async (c) => {
  const { projectId } = c.req.valid("param");
  const ownerUserId = c.get("userId");
  const aggregate = videoCreates.getOwned(projectId, ownerUserId);
  if (!aggregate)
    return c.json(
      { error: { code: "NOT_FOUND", message: "一键成片项目不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  const options = c.req.valid("json");
  if (!videoModelEnabled(options.videoModel))
    return c.json(
      {
        error: {
          code: "VIDEO_MODEL_UNAVAILABLE",
          message: "所选视频模型当前不可用",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      422,
    );
  const shots = videoCreateBatchEligibleShots(aggregate.shots);
  if (!shots.length)
    return c.json(
      {
        error: {
          code: "NO_SHOTS_TO_GENERATE",
          message: "没有待生成或失败的分镜",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  const drafts = shots.map((shot) => getVideoCreateShotGenerationDraft(projectId, shot.id, ownerUserId));
  if (drafts.some((draft) => !draft))
    return c.json(
      {
        error: {
          code: "INVALID_SHOT_GENERATION_DRAFT",
          message: "部分分镜缺少可用的视频生成参数",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      422,
    );
  const batchKey = c.req.header("Idempotency-Key")?.trim().slice(0, 64) ?? crypto.randomUUID();
  const jobs = [];
  for (const [index, shot] of shots.entries()) {
    const draft = drafts[index];
    if (!draft) continue;
    const portrait = draft.attachments.find((attachment) => attachment.source === "portrait");
    jobs.push(
      await enqueueVideoCreateOperation({
        ownerUserId,
        projectId,
        operation: "shot",
        shotId: shot.id,
        shotOptions: {
          ...options,
          prompt: draft.prompt,
          duration: draft.duration,
          referenceMode: draft.referenceMode,
          references: draft.attachments.flatMap((attachment) =>
            attachment.source === "asset" && attachment.assetId
              ? [{ assetId: attachment.assetId, label: attachment.label, category: attachment.category }]
              : [],
          ),
          portrait: portrait?.portraitReference
            ? { reference: portrait.portraitReference, label: portrait.label, category: "人物" }
            : null,
        },
        idempotencyKey: `${batchKey}:${shot.id}`,
      }),
    );
  }
  return c.json({ jobs, submittedShotIds: shots.map((shot) => shot.id) }, 202);
});

const replaceVideoCreateShotRoute = createRoute({
  method: "post",
  path: "/api/video-create/projects/{projectId}/shots/{shotId}/replacement",
  operationId: "replaceVideoCreateShot",
  request: {
    params: z.object({ projectId: z.string().uuid(), shotId: z.string().uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            assetId: z.string().uuid(),
            source: z.enum(["library_replacement", "upload_replacement"]),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: "Replaced", content: { "application/json": { schema: VideoCreateProjectSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Already processing", content: { "application/json": { schema: ErrorSchema } } },
    422: { description: "Invalid video", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(replaceVideoCreateShotRoute, (c) => {
  const { projectId, shotId } = c.req.valid("param");
  const body = c.req.valid("json");
  const shot = videoCreates.getOwnedShot(projectId, shotId, c.get("userId"));
  if (!shot)
    return c.json(
      { error: { code: "NOT_FOUND", message: "分镜不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  if (shot.status === "queued" || shot.status === "generating" || shot.materialProcessing)
    return c.json(
      {
        error: {
          code: "ACTION_IN_PROGRESS",
          message: "该分镜正在处理中",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  const asset = accounts.getOwnedAsset(c.get("userId"), body.assetId);
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
  videoCreates.createAndApplyMaterialVersion({
    projectId,
    shotId,
    source: body.source,
    storageKind: "asset",
    contentId: asset.id,
    inputVersionId: shot.currentMaterialVersionId,
    status: "replaced",
  });
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

const listVideoCreateShotMaterialVersionsRoute = createRoute({
  method: "get",
  path: "/api/video-create/projects/{projectId}/shots/{shotId}/material-versions",
  operationId: "listVideoCreateShotMaterialVersions",
  request: { params: z.object({ projectId: z.string().uuid(), shotId: z.string().uuid() }) },
  responses: {
    200: {
      description: "Material version history",
      content: { "application/json": { schema: z.object({ versions: z.array(VideoCreateMaterialVersionSchema) }) } },
    },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(listVideoCreateShotMaterialVersionsRoute, (c) => {
  const { projectId, shotId } = c.req.valid("param");
  const versions = videoCreates.listMaterialVersions(projectId, shotId, c.get("userId"));
  return versions
    ? c.json(
        {
          versions: versions.map((version) => ({
            ...version,
            ...videoCreateMaterialVersionJobDetails(
              version.jobId ? store.getOwned(version.jobId, c.get("userId")) : undefined,
            ),
            available: Boolean(
              version.status === "succeeded" &&
                version.contentId &&
                (version.storageKind === "artifact"
                  ? accounts.getArtifact(c.get("userId"), version.contentId)
                  : accounts.getOwnedAsset(c.get("userId"), version.contentId)?.mimeType.startsWith("video/")),
            ),
          })),
        },
        200,
      )
    : c.json(
        { error: { code: "NOT_FOUND", message: "分镜不存在", retryable: false, requestId: crypto.randomUUID() } },
        404,
      );
});

const applyVideoCreateShotMaterialVersionRoute = createRoute({
  method: "post",
  path: "/api/video-create/projects/{projectId}/shots/{shotId}/material-versions/{versionId}/apply",
  operationId: "applyVideoCreateShotMaterialVersion",
  request: {
    params: z.object({
      projectId: z.string().uuid(),
      shotId: z.string().uuid(),
      versionId: z.string().uuid(),
    }),
  },
  responses: {
    200: { description: "Applied", content: { "application/json": { schema: VideoCreateProjectSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Not applicable", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(applyVideoCreateShotMaterialVersionRoute, (c) => {
  const { projectId, shotId, versionId } = c.req.valid("param");
  const shot = videoCreates.getOwnedShot(projectId, shotId, c.get("userId"));
  const version = shot ? videoCreates.getMaterialVersion(projectId, shotId, versionId) : undefined;
  if (!shot || !version)
    return c.json(
      { error: { code: "NOT_FOUND", message: "素材版本不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  const available = Boolean(
    version.status === "succeeded" &&
      version.contentId &&
      (version.storageKind === "artifact"
        ? accounts.getArtifact(c.get("userId"), version.contentId)
        : accounts.getOwnedAsset(c.get("userId"), version.contentId)?.mimeType.startsWith("video/")),
  );
  if (!available)
    return c.json(
      {
        error: {
          code: "VERSION_NOT_AVAILABLE",
          message: "该素材版本的文件已不可用",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  try {
    const updated = videoCreates.applyMaterialVersion(projectId, shotId, versionId, c.get("userId"));
    return updated
      ? c.json(updated, 200)
      : c.json(
          { error: { code: "NOT_FOUND", message: "素材版本不存在", retryable: false, requestId: crypto.randomUUID() } },
          404,
        );
  } catch (error) {
    return c.json(
      {
        error: {
          code: error instanceof VideoCreateMaterialBusyError ? "ACTION_IN_PROGRESS" : "VERSION_NOT_APPLICABLE",
          message: error instanceof Error ? error.message : "素材版本无法应用",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  }
});

const processVideoCreateShotMaterialRoute = createRoute({
  method: "post",
  path: "/api/video-create/projects/{projectId}/shots/{shotId}/material-actions/{action}",
  operationId: "processVideoCreateShotMaterial",
  request: {
    params: z.object({
      projectId: z.string().uuid(),
      shotId: z.string().uuid(),
      action: z.enum(["audio-replace", "subtitle-compose"]),
    }),
  },
  responses: {
    202: { description: "Accepted", content: { "application/json": { schema: JobSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Invalid state", content: { "application/json": { schema: ErrorSchema } } },
    422: { description: "Provider unavailable", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(processVideoCreateShotMaterialRoute, async (c) => {
  const { projectId, shotId, action } = c.req.valid("param");
  const shot = videoCreates.getOwnedShot(projectId, shotId, c.get("userId"));
  if (!shot)
    return c.json(
      { error: { code: "NOT_FOUND", message: "分镜不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  if (action === "audio-replace") {
    const availability = providerFeatureAvailability(["volc-speech"]);
    if (!availability.enabled)
      return c.json(
        {
          error: {
            code: "PROVIDER_UNAVAILABLE",
            message: availability.disabledReason ?? "火山语音不可用",
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        },
        422,
      );
  }
  if (!shot.currentMaterialVersionId || !shot.videoAssetId)
    return c.json(
      {
        error: {
          code: "VIDEO_REQUIRED",
          message: "请先生成或选择视频素材",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  if (action === "audio-replace" && !shot.audioArtifactId)
    return c.json(
      {
        error: {
          code: "AUDIO_REQUIRED",
          message: "请先生成配音",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  if (action === "subtitle-compose" && !shot.subtitleCues.length)
    return c.json(
      {
        error: {
          code: "SUBTITLE_REQUIRED",
          message: "请先生成字幕",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  if (action === "subtitle-compose" && shot.subtitlesComposed && !shot.subtitleStyleStale)
    return c.json(
      {
        error: {
          code: "SUBTITLES_ALREADY_COMPOSED",
          message: "当前视频已合成字幕，请勿重复合成",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  try {
    const job = await enqueueVideoCreateOperation({
      ownerUserId: c.get("userId"),
      projectId,
      operation: action,
      shotId,
      idempotencyKey: c.req.header("Idempotency-Key")?.trim().slice(0, 128),
    });
    return c.json(job, 202);
  } catch (error) {
    if (!(error instanceof VideoCreateMaterialBusyError)) throw error;
    return c.json(
      {
        error: {
          code: "ACTION_IN_PROGRESS",
          message: error.message,
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  }
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

const updateAllVideoCreateShotSettingsRoute = createRoute({
  method: "patch",
  path: "/api/video-create/projects/{projectId}/shots",
  operationId: "updateAllVideoCreateShotSettings",
  request: {
    params: z.object({ projectId: z.string().uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({ audioEnabled: z.boolean().optional(), subtitleEnabled: z.boolean().optional() })
            .refine((value) => value.audioEnabled !== undefined || value.subtitleEnabled !== undefined),
        },
      },
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: VideoCreateProjectSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(updateAllVideoCreateShotSettingsRoute, (c) => {
  const { projectId } = c.req.valid("param");
  if (!videoCreates.getOwned(projectId, c.get("userId")))
    return c.json(
      {
        error: { code: "NOT_FOUND", message: "一键成片项目不存在", retryable: false, requestId: crypto.randomUUID() },
      },
      404,
    );
  const updated = videoCreates.updateAllShotSettings(projectId, c.req.valid("json"));
  return updated
    ? c.json(updated, 200)
    : c.json(
        {
          error: { code: "NOT_FOUND", message: "一键成片项目不存在", retryable: false, requestId: crypto.randomUUID() },
        },
        404,
      );
});

const updateVideoCreateMediaSettingsRoute = createRoute({
  method: "patch",
  path: "/api/video-create/projects/{projectId}/media-settings",
  operationId: "updateVideoCreateMediaSettings",
  request: {
    params: z.object({ projectId: z.string().uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              voiceSettings: VideoCreateVoiceSettingsSchema.optional(),
              subtitleStyleId: VideoCreateSubtitleStyleIdSchema.optional(),
            })
            .refine((value) => value.voiceSettings !== undefined || value.subtitleStyleId !== undefined),
        },
      },
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: VideoCreateProjectSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Action in progress", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(updateVideoCreateMediaSettingsRoute, (c) => {
  try {
    const updated = videoCreates.updateMediaSettings(
      c.req.valid("param").projectId,
      c.get("userId"),
      c.req.valid("json"),
    );
    return updated
      ? c.json(updated, 200)
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
    if (!(error instanceof VideoCreateStateError)) throw error;
    return c.json(
      {
        error: {
          code: "ACTION_IN_PROGRESS",
          message: error.message,
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  }
});

const previewVideoCreateVoiceRoute = createRoute({
  method: "post",
  path: "/api/video-create/voice-preview",
  operationId: "previewVideoCreateVoice",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ voiceSettings: VideoCreateVoiceSettingsSchema, text: z.string().trim().min(1).max(80) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Voice preview",
      content: {
        "application/json": {
          schema: z.object({ audioBase64: z.string(), mimeType: z.literal("audio/mpeg") }),
        },
      },
    },
    422: { description: "Provider unavailable", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(previewVideoCreateVoiceRoute, async (c) => {
  const availability = providerFeatureAvailability(["volc-speech"]);
  if (!availability.enabled)
    return c.json(
      {
        error: {
          code: "PROVIDER_UNAVAILABLE",
          message: availability.disabledReason ?? "火山语音不可用",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      422,
    );
  const { voiceSettings, text } = c.req.valid("json");
  const result = await volcSpeech.synthesize({
    requestId: crypto.randomUUID(),
    resourceId: env.volcSpeech.presetTtsResourceId,
    speaker: voiceSettings.presetVoiceId,
    text,
    model: "seed-tts-2.0-expressive",
    speechRate: videoCreateVoiceSpeechRate(voiceSettings.speed),
    explicitLanguage: "zh",
    contextText: videoCreateVoiceContextText(voiceSettings.style),
    toneFidelity: false,
  });
  return c.json({ audioBase64: Buffer.from(result.bytes).toString("base64"), mimeType: "audio/mpeg" as const }, 200);
});

const batchGenerateVideoCreateAudioRoute = createRoute({
  method: "post",
  path: "/api/video-create/projects/{projectId}/shots/batch-audio",
  operationId: "batchGenerateVideoCreateAudio",
  request: { params: z.object({ projectId: z.string().uuid() }) },
  responses: {
    202: {
      description: "Accepted",
      content: {
        "application/json": {
          schema: z.object({ jobs: z.array(JobSchema), submittedShotIds: z.array(z.string().uuid()) }),
        },
      },
    },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    409: { description: "Nothing to generate", content: { "application/json": { schema: ErrorSchema } } },
    422: { description: "Provider unavailable", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(batchGenerateVideoCreateAudioRoute, async (c) => {
  const { projectId } = c.req.valid("param");
  const ownerUserId = c.get("userId");
  const aggregate = videoCreates.getOwned(projectId, ownerUserId);
  if (!aggregate)
    return c.json(
      { error: { code: "NOT_FOUND", message: "一键成片项目不存在", retryable: false, requestId: crypto.randomUUID() } },
      404,
    );
  const availability = providerFeatureAvailability(["volc-speech"]);
  if (!availability.enabled)
    return c.json(
      {
        error: {
          code: "PROVIDER_UNAVAILABLE",
          message: availability.disabledReason ?? "火山语音不可用",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      422,
    );
  const shots = videoCreateBatchEligibleAudioShots(aggregate.shots);
  if (!shots.length)
    return c.json(
      {
        error: {
          code: "NO_AUDIO_TO_GENERATE",
          message: "没有可生成配音的分镜",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      409,
    );
  const batchKey = c.req.header("Idempotency-Key")?.trim().slice(0, 64) ?? crypto.randomUUID();
  const jobs = [];
  for (const shot of shots)
    jobs.push(
      await enqueueVideoCreateOperation({
        ownerUserId,
        projectId,
        operation: "audio-generate",
        shotId: shot.id,
        idempotencyKey: `${batchKey}:${shot.id}`,
      }),
    );
  return c.json({ jobs, submittedShotIds: shots.map((shot) => shot.id) }, 202);
});

const qwenVoiceSamplePreflightRoute = createRoute({
  method: "post",
  path: "/api/voice-clone/qwen/sample-preflight",
  operationId: "preflightQwenVoiceSample",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ assetId: z.string().uuid() }) } },
    },
  },
  responses: {
    200: {
      description: "Sample is valid",
      content: {
        "application/json": {
          schema: z.object({
            durationSec: z.number().min(0.001),
            format: z.string(),
            channels: z.number().int().min(1).optional(),
            sampleRate: z.number().int().min(1).optional(),
          }),
        },
      },
    },
    422: { description: "Invalid sample", content: { "application/json": { schema: ErrorSchema } } },
  },
});
app.openapi(qwenVoiceSamplePreflightRoute, async (c) => {
  const ownerUserId = c.get("userId");
  const { assetId } = c.req.valid("json");
  try {
    return c.json(await preflightQwenVoiceSample(ownerUserId, assetId, accounts), 200);
  } catch (error) {
    if (error instanceof QwenVoiceSamplePreflightError)
      return c.json(
        {
          error: {
            code: "INVALID_QWEN_VOICE_SAMPLE",
            message: error.message,
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        },
        422,
      );
    throw error;
  }
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
  if (moduleId === "ad-script" || moduleId === "video-create" || moduleId === "ai-generate")
    return c.json(
      {
        error: {
          code: "DEDICATED_WORKFLOW_REQUIRED",
          message:
            moduleId === "ad-script"
              ? "口播脚本必须通过专用创作流程提交"
              : moduleId === "video-create"
                ? "一键成片必须通过专用项目流程提交"
                : "AI 创作必须通过专用强类型接口提交",
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
  const body = c.req.valid("json");
  if (moduleId === "voice-clone" && body.values.voiceProvider !== "qwen")
    return c.json(
      {
        error: {
          code: "QWEN_VOICE_CLONE_REQUIRED",
          message: "新建音色克隆任务仅支持 Qwen",
          retryable: false,
          requestId: crypto.randomUUID(),
        },
      },
      422,
    );
  const isQwenVoiceClone = moduleId === "voice-clone" && body.values.voiceProvider === "qwen";
  const availability = isQwenVoiceClone
    ? providerFeatureAvailability(["qwen-audio", "tos"])
    : moduleFeatureAvailability(moduleId);
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
  const ownerUserId = c.get("userId");
  const jobValues = { ...body.values };
  jobValues.allowMockFallback = String(body.allowMockFallback);
  let mashupConfig: VideoMashupConfig | undefined;
  if (isQwenVoiceClone) {
    const invalidMessage = validateQwenVoiceCloneValues(jobValues);
    if (invalidMessage)
      return c.json(
        {
          error: {
            code: "INVALID_QWEN_VOICE_CLONE_CONFIG",
            message: invalidMessage,
            retryable: false,
            requestId: crypto.randomUUID(),
          },
        },
        422,
      );
    const sourceAssetId = jobValues.sample?.split(":", 3)[1] ?? "";
    try {
      await preflightQwenVoiceSample(ownerUserId, sourceAssetId, accounts);
    } catch (error) {
      if (error instanceof QwenVoiceSamplePreflightError)
        return c.json(
          {
            error: {
              code: "INVALID_QWEN_VOICE_SAMPLE",
              message: error.message,
              retryable: false,
              requestId: crypto.randomUUID(),
            },
          },
          422,
        );
      throw error;
    }
    const submittedAt = new Date().toISOString();
    jobValues.auditReference = `authenticated-submission:${ownerUserId}:${submittedAt}`;
    jobValues.submittedByUserId = ownerUserId;
    jobValues.submittedAt = submittedAt;
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
  if (isAiToolModuleId(moduleId)) {
    const outputFolderId = jobValues.outputFolderId;
    if (outputFolderId && !accounts.getAssetFolder(ownerUserId, outputFolderId))
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
  } else if (moduleId === "video-extract" || moduleId === "video-editor") {
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
  const needsVideoModel = moduleId === "video-remix";
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
  store.create(job);
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
  if (!created.created) {
    emitLog({ jobId: created.job.id, stage: "task_queued", result: "ok", durationMs: 0, message: "复用已有任务" });
    return c.json(created.job, 202);
  }
  await queue.enqueue(jobId);
  emitLog({ jobId, stage: "task_queued", result: "ok", durationMs: 0 });
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
