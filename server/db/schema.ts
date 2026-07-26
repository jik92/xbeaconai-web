import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AiToolModuleId } from "../../shared/jobs/ai-tool-modules";
import type { PortraitGender } from "../../shared/portraits/portrait-tags";
import type { JobModuleId, JobRecord, JobResult, JobStatus, StageProvenance } from "../types";

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

export const providerCredentialChecks = sqliteTable("provider_credential_checks", {
  providerId: text("provider_id").primaryKey(),
  provider: text("provider").notNull(),
  status: text("status", { enum: ["available", "missing", "invalid", "timeout"] }).notNull(),
  message: text("message").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  checkedAt: text("checked_at").notNull(),
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

export const moduleOutputFolderDefaults = sqliteTable(
  "module_output_folder_defaults",
  {
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    moduleId: text("module_id").$type<AiToolModuleId>().notNull(),
    folderId: text("folder_id")
      .notNull()
      .references(() => assetFolders.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("module_output_folder_defaults_owner_module_idx").on(table.ownerUserId, table.moduleId),
    index("module_output_folder_defaults_folder_idx").on(table.folderId),
  ],
);

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

export const adminCreditGrants = sqliteTable(
  "admin_credit_grants",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    adminUserId: text("admin_user_id")
      .notNull()
      .references(() => users.id),
    idempotencyKey: text("idempotency_key").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    credits: integer("credits").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("admin_credit_grants_admin_idempotency_idx").on(table.adminUserId, table.idempotencyKey),
    index("admin_credit_grants_user_created_idx").on(table.userId, table.createdAt),
  ],
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

export const arkPortraitGroups = sqliteTable("ark_portrait_groups", {
  ownerUserId: text("owner_user_id")
    .primaryKey()
    .references(() => users.id),
  groupId: text("group_id"),
  projectName: text("project_name").notNull().default("default"),
  status: text("status", { enum: ["creating", "active", "failed"] }).notNull(),
  claimToken: text("claim_token").notNull(),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const customPortraits = sqliteTable(
  "custom_portraits",
  {
    assetId: text("asset_id")
      .primaryKey()
      .references(() => mediaAssets.id),
    jobId: text("job_id").references(() => jobs.id),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id),
    groupId: text("group_id"),
    arkAssetId: text("ark_asset_id").unique(),
    gender: text("gender", { enum: ["男", "女"] }).$type<PortraitGender>(),
    status: text("status", { enum: ["queued", "processing", "active", "failed"] }).notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("custom_portraits_owner_created_idx").on(table.ownerUserId, table.createdAt),
    index("custom_portraits_owner_status_idx").on(table.ownerUserId, table.status),
  ],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id"),
    moduleId: text("module_id").$type<JobModuleId>().notNull(),
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

export const providerGenerationAudits = sqliteTable(
  "provider_generation_audits",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id),
    moduleId: text("module_id").notNull(),
    capability: text("capability").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    operation: text("operation").notNull(),
    providerTaskId: text("provider_task_id"),
    providerRequestId: text("provider_request_id"),
    status: text("status", { enum: ["submitting", "processing", "succeeded", "failed", "cancelled"] }).notNull(),
    requestPayload: text("request_payload_json", { mode: "json" }).$type<unknown>().notNull(),
    responsePayload: text("response_payload_json", { mode: "json" }).$type<unknown>(),
    errorPayload: text("error_payload_json", { mode: "json" }).$type<unknown>(),
    assetIds: text("asset_ids_json", { mode: "json" }).$type<string[]>().notNull().default([]),
    submittedAt: text("submitted_at").notNull(),
    completedAt: text("completed_at"),
    durationMs: integer("duration_ms"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("provider_generation_audits_job_operation_idx").on(table.jobId, table.capability, table.operation),
    index("provider_generation_audits_owner_submitted_idx").on(table.ownerUserId, table.submittedAt),
    index("provider_generation_audits_provider_submitted_idx").on(table.provider, table.submittedAt),
    index("provider_generation_audits_status_submitted_idx").on(table.status, table.submittedAt),
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
    autoGenerate: integer("auto_generate", { mode: "boolean" }).notNull().default(false),
    autoGenerateRunId: text("auto_generate_run_id"),
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
    narration: text("narration").notNull().default(""),
    generationPlan: text("generation_plan_json", { mode: "json" }).$type<
      import("../video-create/types").VideoCreateShotGenerationPlan
    >(),
    durationSec: integer("duration_sec").notNull(),
    status: text("status").$type<import("../video-create/types").VideoCreateShotStatus>().notNull().default("pending"),
    jobId: text("job_id").references(() => jobs.id),
    videoAssetId: text("video_asset_id"),
    currentMaterialVersionId: text("current_material_version_id"),
    audioArtifactId: text("audio_artifact_id"),
    audioSettingsKey: text("audio_settings_key"),
    subtitleCues: text("subtitle_cues_json", { mode: "json" })
      .$type<import("../video-create/types").VideoCreateSubtitleCue[]>()
      .notNull()
      .default([]),
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

export const videoCreateMaterialVersions = sqliteTable(
  "video_create_material_versions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => videoCreateProjects.id),
    shotId: text("shot_id")
      .notNull()
      .references(() => videoCreateShots.id, { onDelete: "cascade" }),
    source: text("source").$type<import("../video-create/types").VideoCreateMaterialVersionSource>().notNull(),
    status: text("status").$type<import("../video-create/types").VideoCreateMaterialVersionStatus>().notNull(),
    storageKind: text("storage_kind").$type<import("../video-create/types").VideoCreateMaterialStorageKind>(),
    contentId: text("content_id"),
    inputVersionId: text("input_version_id"),
    jobId: text("job_id").references(() => jobs.id),
    subtitlesComposed: integer("subtitles_composed", { mode: "boolean" }).notNull().default(false),
    subtitleStyleId:
      text("subtitle_style_id").$type<import("../../shared/video-create/media-settings").VideoCreateSubtitleStyleId>(),
    error: text("error_json", { mode: "json" }).$type<JobRecord["error"]>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("video_create_material_versions_shot_created_idx").on(table.shotId, table.createdAt),
    index("video_create_material_versions_project_idx").on(table.projectId),
    uniqueIndex("video_create_material_versions_job_idx").on(table.jobId),
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

export const qianchuanOauthStates = sqliteTable(
  "qianchuan_oauth_states",
  {
    stateHash: text("state_hash").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    consumedAt: text("consumed_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("qianchuan_oauth_states_owner_idx").on(table.ownerUserId, table.createdAt)],
);

export const qianchuanBindings = sqliteTable(
  "qianchuan_bindings",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    authUserId: text("auth_user_id").notNull(),
    subjectId: text("subject_id"),
    subjectName: text("subject_name").notNull().default(""),
    subjectType: text("subject_type").notNull().default("AGENCY"),
    accessTokenCiphertext: text("access_token_ciphertext").notNull(),
    accessTokenNonce: text("access_token_nonce").notNull(),
    accessTokenAuthTag: text("access_token_auth_tag").notNull(),
    refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
    refreshTokenNonce: text("refresh_token_nonce").notNull(),
    refreshTokenAuthTag: text("refresh_token_auth_tag").notNull(),
    accessTokenExpiresAt: text("access_token_expires_at").notNull(),
    refreshTokenExpiresAt: text("refresh_token_expires_at").notNull(),
    defaultAdvertiserId: text("default_advertiser_id"),
    status: text("status", { enum: ["active", "reauthorization_required", "revoked"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("qianchuan_bindings_owner_auth_user_idx").on(table.ownerUserId, table.authUserId),
    index("qianchuan_bindings_owner_idx").on(table.ownerUserId, table.updatedAt),
  ],
);

export const qianchuanAdvertisers = sqliteTable(
  "qianchuan_advertisers",
  {
    id: text("id").primaryKey(),
    bindingId: text("binding_id")
      .notNull()
      .references(() => qianchuanBindings.id, { onDelete: "cascade" }),
    advertiserId: text("advertiser_id").notNull(),
    name: text("name").notNull(),
    accountRole: text("account_role").notNull().default("ADVERTISER"),
    status: text("status").notNull().default("ACTIVE"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("qianchuan_advertisers_binding_advertiser_idx").on(table.bindingId, table.advertiserId),
    index("qianchuan_advertisers_binding_idx").on(table.bindingId),
  ],
);

export const qianchuanMaterials = sqliteTable(
  "qianchuan_materials",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bindingId: text("binding_id")
      .notNull()
      .references(() => qianchuanBindings.id, { onDelete: "cascade" }),
    advertiserId: text("advertiser_id").notNull(),
    assetId: text("asset_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["video", "image"] }).notNull(),
    upstreamMaterialId: text("upstream_material_id"),
    status: text("status", { enum: ["queued", "uploading", "ready", "failed"] })
      .notNull()
      .default("queued"),
    requestId: text("request_id"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("qianchuan_materials_account_asset_idx").on(table.advertiserId, table.assetId, table.kind),
    index("qianchuan_materials_owner_idx").on(table.ownerUserId, table.updatedAt),
  ],
);

export const qianchuanDeliveries = sqliteTable(
  "qianchuan_deliveries",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bindingId: text("binding_id")
      .notNull()
      .references(() => qianchuanBindings.id, { onDelete: "cascade" }),
    advertiserId: text("advertiser_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    name: text("name").notNull(),
    status: text("status", {
      enum: ["draft", "queued", "submitting", "paused", "reviewing", "active", "rejected", "failed"],
    })
      .notNull()
      .default("queued"),
    campaignId: text("campaign_id"),
    adId: text("ad_id"),
    creativeId: text("creative_id"),
    requestPayload: text("request_payload_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    reportSummary: text("report_summary_json", { mode: "json" }).$type<Record<string, number>>(),
    requestId: text("request_id"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("qianchuan_deliveries_owner_idempotency_idx").on(table.ownerUserId, table.idempotencyKey),
    index("qianchuan_deliveries_owner_updated_idx").on(table.ownerUserId, table.updatedAt),
  ],
);

export const qianchuanReports = sqliteTable(
  "qianchuan_reports",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deliveryId: text("delivery_id")
      .notNull()
      .references(() => qianchuanDeliveries.id, { onDelete: "cascade" }),
    reportDate: text("report_date").notNull(),
    level: text("level", { enum: ["account", "campaign", "material"] }).notNull(),
    metrics: text("metrics_json", { mode: "json" }).$type<Record<string, number>>().notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("qianchuan_reports_delivery_date_level_idx").on(table.deliveryId, table.reportDate, table.level),
    index("qianchuan_reports_owner_date_idx").on(table.ownerUserId, table.reportDate),
  ],
);
