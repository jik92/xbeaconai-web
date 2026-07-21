import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { ModuleId } from "../../web/entities/types";
import type { JobRecord, JobResult, JobStatus, StageProvenance } from "../types";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    phone: text("phone").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    avatarText: text("avatar_text").notNull(),
    credits: integer("credits").notNull().default(2480),
    status: text("status", { enum: ["pending_password", "active", "disabled"] })
      .notNull()
      .default("active"),
    passwordVersion: integer("password_version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("users_phone_idx").on(table.phone)],
);

export const smsVerificationCodes = sqliteTable(
  "sms_verification_codes",
  {
    id: text("id").primaryKey(),
    phone: text("phone").notNull(),
    purpose: text("purpose", { enum: ["register", "reset_password"] }).notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("sms_codes_phone_purpose_created_idx").on(table.phone, table.purpose, table.createdAt)],
);

export const passwordSetupTokens = sqliteTable(
  "password_setup_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    purpose: text("purpose", { enum: ["initial_setup", "reset_password"] }).notNull(),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("password_setup_tokens_user_created_idx").on(table.userId, table.createdAt)],
);

export const providerCredentials = sqliteTable("provider_credentials", {
  name: text("name").primaryKey(),
  ciphertext: text("ciphertext").notNull(),
  nonce: text("nonce").notNull(),
  authTag: text("auth_tag").notNull(),
  lastFour: text("last_four").notNull(),
  updatedByUserId: text("updated_by_user_id"),
  updatedAt: text("updated_at").notNull(),
});

export const assetFolders = sqliteTable(
  "asset_folders",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id),
    parentId: text("parent_id").references((): AnySQLiteColumn => assetFolders.id),
    name: text("name").notNull(),
    storagePrefix: text("storage_prefix").notNull().unique(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("asset_folders_owner_parent_idx").on(table.ownerUserId, table.parentId, table.name)],
);

export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id),
  theme: text("theme", { enum: ["light", "system"] })
    .notNull()
    .default("system"),
  defaultRatio: text("default_ratio", { enum: ["9:16", "16:9", "1:1"] })
    .notNull()
    .default("9:16"),
  language: text("language", { enum: ["zh-CN", "en"] })
    .notNull()
    .default("zh-CN"),
  taskNotifications: integer("task_notifications", { mode: "boolean" }).notNull().default(true),
  autoplayResults: integer("autoplay_results", { mode: "boolean" }).notNull().default(false),
  defaultAssetFolderId: text("default_asset_folder_id").references(() => assetFolders.id),
  updatedAt: text("updated_at").notNull(),
});

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    jti: text("jti").notNull().unique(),
    passwordVersion: integer("password_version").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => [uniqueIndex("auth_sessions_jti_idx").on(table.jti)],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(),
    sourceId: text("source_id"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    readAt: text("read_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("notifications_source_idx").on(table.userId, table.type, table.sourceId),
    index("notifications_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const rechargeOrders = sqliteTable(
  "recharge_orders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    idempotencyKey: text("idempotency_key").notNull(),
    packageId: text("package_id").notNull(),
    amountCny: integer("amount_cny").notNull(),
    credits: integer("credits").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    status: text("status", { enum: ["succeeded"] }).notNull(),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at").notNull(),
  },
  (table) => [uniqueIndex("recharge_orders_user_idempotency_idx").on(table.userId, table.idempotencyKey)],
);

export const mediaAssets = sqliteTable(
  "media_assets",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id),
    originalName: text("original_name").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationSec: real("duration_sec"),
    assetKind: text("asset_kind", { enum: ["media", "product", "portrait", "voice"] })
      .notNull()
      .default("media"),
    displayName: text("display_name").notNull().default(""),
    description: text("description"),
    productGroupId: text("product_group_id"),
    sortOrder: integer("sort_order").notNull().default(0),
    sharingScope: text("sharing_scope", { enum: ["private", "team", "organization"] })
      .notNull()
      .default("private"),
    folderId: text("folder_id").references(() => assetFolders.id),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("media_assets_storage_key_idx").on(table.storageKey),
    index("media_assets_owner_kind_idx").on(table.ownerUserId, table.assetKind, table.createdAt),
  ],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id"),
    moduleId: text("module_id").$type<ModuleId>().notNull(),
    title: text("title").notNull(),
    status: text("status").$type<JobStatus>().notNull(),
    progress: integer("progress").notNull(),
    stage: text("stage").notNull(),
    overallExecutionMode: text("overall_execution_mode").$type<JobRecord["overallExecutionMode"]>().notNull(),
    values: text("values_json", { mode: "json" }).$type<Record<string, string>>().notNull(),
    videoModel: text("video_model").$type<JobRecord["videoModel"]>(),
    executionPlan: text("execution_plan_json", { mode: "json" }).$type<StageProvenance[]>().notNull(),
    provenance: text("provenance_json", { mode: "json" }).$type<StageProvenance[]>().notNull(),
    result: text("result_json", { mode: "json" }).$type<JobResult>(),
    error: text("error_json", { mode: "json" }).$type<JobRecord["error"]>(),
    parentJobId: text("parent_job_id"),
    idempotencyKey: text("idempotency_key"),
    cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
    providerModel: text("provider_model").$type<JobRecord["providerModel"]>(),
    providerTaskId: text("provider_task_id"),
    providerStatus: text("provider_status"),
    providerSubmittedAt: text("provider_submitted_at"),
    providerDeadlineAt: text("provider_deadline_at"),
    providerCancelState: text("provider_cancel_state").$type<JobRecord["providerCancelState"]>().default("none"),
    stagingKeys: text("staging_keys_json", { mode: "json" }).$type<string[]>().notNull().default([]),
    jobSchemaVersion: integer("job_schema_version").$type<1 | 2>().notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("jobs_module_created_idx").on(table.moduleId, table.createdAt),
    index("jobs_status_created_idx").on(table.status, table.createdAt),
    index("jobs_owner_created_idx").on(table.ownerUserId, table.createdAt),
    uniqueIndex("jobs_idempotency_idx").on(table.ownerUserId, table.idempotencyKey),
  ],
);

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id),
    jobId: text("job_id").notNull(),
    storageKey: text("storage_key").notNull(),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("artifacts_owner_idx").on(table.ownerUserId, table.id)],
);

export const creditCharges = sqliteTable(
  "credit_charges",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    jobId: text("job_id").notNull().unique(),
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("credit_charges_job_idx").on(table.jobId)],
);

export const creditRefunds = sqliteTable(
  "credit_refunds",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    jobId: text("job_id").notNull(),
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    reason: text("reason").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("credit_refunds_job_idx").on(table.jobId)],
);

export const adScriptProjects = sqliteTable(
  "ad_script_projects",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id),
    jobId: text("job_id").references(() => jobs.id),
    status: text("status", {
      enum: ["draft", "queued", "processing", "succeeded", "partially_succeeded", "failed", "cancelled"],
    })
      .notNull()
      .default("draft"),
    input: text("input_json", { mode: "json" }).$type<import("../ad-script/types").AdScriptInput>().notNull(),
    idempotencyKey: text("idempotency_key"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("ad_script_projects_owner_updated_idx").on(table.ownerUserId, table.updatedAt),
    uniqueIndex("ad_script_projects_owner_idempotency_idx").on(table.ownerUserId, table.idempotencyKey),
  ],
);

export const adScriptVariants = sqliteTable(
  "ad_script_variants",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => adScriptProjects.id),
    ordinal: integer("ordinal").notNull(),
    status: text("status", { enum: ["queued", "processing", "succeeded", "failed", "cancelled"] })
      .notNull()
      .default("queued"),
    currentVersionId: text("current_version_id"),
    finalScore: integer("final_score"),
    compliancePassed: integer("compliance_passed", { mode: "boolean" }),
    iterationCount: integer("iteration_count").notNull().default(0),
    error: text("error_json", { mode: "json" }).$type<{
      code: string;
      message: string;
      retryable: boolean;
      requestId: string;
    }>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("ad_script_variants_project_ordinal_idx").on(table.projectId, table.ordinal),
    index("ad_script_variants_project_idx").on(table.projectId),
  ],
);

export const adScriptVersions = sqliteTable(
  "ad_script_versions",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id")
      .notNull()
      .references(() => adScriptVariants.id),
    sequence: integer("sequence").notNull(),
    source: text("source", { enum: ["initial", "optimized", "human"] }).notNull(),
    parentVersionId: text("parent_version_id"),
    round: integer("round").notNull(),
    script: text("script").notNull(),
    score: text("score_json", { mode: "json" }).$type<import("../ad-script/types").AdScriptScoreDetail>().notNull(),
    compliance: text("compliance_json", { mode: "json" })
      .$type<import("../ad-script/types").AdScriptCompliance>()
      .notNull(),
    changeSummary: text("change_summary").notNull(),
    model: text("model").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("ad_script_versions_variant_sequence_idx").on(table.variantId, table.sequence),
    index("ad_script_versions_variant_created_idx").on(table.variantId, table.createdAt),
  ],
);

export const videoCreateProjects = sqliteTable(
  "video_create_projects",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    status: text("status").$type<import("../video-create/types").VideoCreateProjectStatus>().notNull().default("draft"),
    input: text("input_json", { mode: "json" }).$type<import("../video-create/types").VideoCreateInput>().notNull(),
    recommendation: text("recommendation_json", { mode: "json" }).$type<
      import("../video-create/types").VideoCreateRecommendation
    >(),
    currentJobId: text("current_job_id").references(() => jobs.id),
    finalArtifactId: text("final_artifact_id"),
    version: integer("version").notNull().default(1),
    idempotencyKey: text("idempotency_key"),
    error: text("error_json", { mode: "json" }).$type<JobRecord["error"]>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("video_create_projects_owner_updated_idx").on(table.ownerUserId, table.updatedAt),
    uniqueIndex("video_create_projects_owner_idempotency_idx").on(table.ownerUserId, table.idempotencyKey),
  ],
);

export const videoCreateScriptSections = sqliteTable(
  "video_create_script_sections",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => videoCreateProjects.id),
    ordinal: integer("ordinal").notNull(),
    label: text("label").notNull(),
    currentVersionId: text("current_version_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("video_create_sections_project_ordinal_idx").on(table.projectId, table.ordinal),
    index("video_create_sections_project_idx").on(table.projectId),
  ],
);

export const videoCreateScriptVersions = sqliteTable(
  "video_create_script_versions",
  {
    id: text("id").primaryKey(),
    sectionId: text("section_id")
      .notNull()
      .references(() => videoCreateScriptSections.id),
    sequence: integer("sequence").notNull(),
    source: text("source", { enum: ["generated", "regenerated", "human"] }).notNull(),
    parentVersionId: text("parent_version_id"),
    text: text("text").notNull(),
    durationSec: integer("duration_sec").notNull(),
    model: text("model").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("video_create_versions_section_sequence_idx").on(table.sectionId, table.sequence),
    index("video_create_versions_section_idx").on(table.sectionId),
  ],
);

export const videoCreateShots = sqliteTable(
  "video_create_shots",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => videoCreateProjects.id),
    scriptSectionId: text("script_section_id")
      .notNull()
      .references(() => videoCreateScriptSections.id),
    ordinal: integer("ordinal").notNull(),
    prompt: text("prompt").notNull(),
    durationSec: integer("duration_sec").notNull(),
    status: text("status").$type<import("../video-create/types").VideoCreateShotStatus>().notNull().default("pending"),
    jobId: text("job_id").references(() => jobs.id),
    videoAssetId: text("video_asset_id"),
    audioEnabled: integer("audio_enabled", { mode: "boolean" }).notNull().default(true),
    subtitleEnabled: integer("subtitle_enabled", { mode: "boolean" }).notNull().default(true),
    attempts: integer("attempts").notNull().default(0),
    error: text("error_json", { mode: "json" }).$type<JobRecord["error"]>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("video_create_shots_project_ordinal_idx").on(table.projectId, table.ordinal),
    index("video_create_shots_project_idx").on(table.projectId),
  ],
);

export const objectCleanup = sqliteTable("object_cleanup", {
  objectKey: text("object_key").primaryKey(),
  jobId: text("job_id").notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  nextAttemptAt: text("next_attempt_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const migrationState = sqliteTable("migration_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});
