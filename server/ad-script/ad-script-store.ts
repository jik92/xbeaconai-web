import { and, asc, desc, eq, max } from "drizzle-orm";
import { type AppDatabase, openDatabase } from "../db/database";
import {
  adScriptProjects,
  adScriptVariants,
  adScriptVersions,
  creditCharges,
  creditRefunds,
  jobs,
  users,
} from "../db/schema";
import { env } from "../env";
import { InsufficientCreditsError } from "../jobs/sqlite-job-store";
import type { JobRecord } from "../types";
import type { AdScriptCompliance, AdScriptInput, AdScriptScoreDetail } from "./types";
import { AD_SCRIPT_CREDITS_PER_VARIANT, AD_SCRIPT_MODEL } from "./types";

type ProjectRow = typeof adScriptProjects.$inferSelect;
type VariantRow = typeof adScriptVariants.$inferSelect;
type VersionRow = typeof adScriptVersions.$inferSelect;

export class AdScriptVersionConflictError extends Error {}

const jobValues = (job: JobRecord): typeof jobs.$inferInsert => ({
  id: job.id,
  ownerUserId: job.ownerUserId,
  moduleId: job.moduleId,
  title: job.title,
  status: job.status,
  progress: job.progress,
  stage: job.stage,
  overallExecutionMode: job.overallExecutionMode,
  values: job.values,
  videoModel: job.videoModel,
  executionPlan: job.executionPlan,
  provenance: job.provenance,
  result: job.result,
  error: job.error,
  parentJobId: job.parentJobId,
  idempotencyKey: job.idempotencyKey,
  cancelRequested: job.cancelRequested,
  providerModel: job.providerModel,
  providerTaskId: job.providerTaskId,
  providerStatus: job.providerStatus,
  providerSubmittedAt: job.providerSubmittedAt,
  providerDeadlineAt: job.providerDeadlineAt,
  providerCancelState: job.providerCancelState ?? "none",
  stagingKeys: job.stagingKeys,
  jobSchemaVersion: job.jobSchemaVersion,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});

export interface AdScriptAggregate {
  project: ProjectRow;
  variants: Array<VariantRow & { versions: VersionRow[] }>;
}

export class AdScriptStore {
  readonly db: AppDatabase;
  private readonly client: ReturnType<typeof openDatabase>["client"];

  constructor(path = env.databasePath) {
    const connection = openDatabase(path);
    this.client = connection.client;
    this.db = connection.db;
  }

  close() {
    this.client.close();
  }

  getOwned(projectId: string, ownerUserId: string): AdScriptAggregate | undefined {
    const project = this.db
      .select()
      .from(adScriptProjects)
      .where(and(eq(adScriptProjects.id, projectId), eq(adScriptProjects.ownerUserId, ownerUserId)))
      .get();
    return project ? this.aggregate(project) : undefined;
  }

  getByJobId(jobId: string): AdScriptAggregate | undefined {
    const project = this.db.select().from(adScriptProjects).where(eq(adScriptProjects.jobId, jobId)).get();
    return project ? this.aggregate(project) : undefined;
  }

  getByIdempotencyKey(ownerUserId: string, idempotencyKey: string): AdScriptAggregate | undefined {
    const project = this.db
      .select()
      .from(adScriptProjects)
      .where(and(eq(adScriptProjects.ownerUserId, ownerUserId), eq(adScriptProjects.idempotencyKey, idempotencyKey)))
      .get();
    return project ? this.aggregate(project) : undefined;
  }

  listOwned(ownerUserId: string) {
    return this.db
      .select()
      .from(adScriptProjects)
      .where(eq(adScriptProjects.ownerUserId, ownerUserId))
      .orderBy(desc(adScriptProjects.updatedAt))
      .limit(50)
      .all()
      .map((project) => this.aggregate(project));
  }

  createCharged(input: {
    projectId: string;
    ownerUserId: string;
    projectInput: AdScriptInput;
    idempotencyKey: string;
    job: JobRecord;
  }): AdScriptAggregate {
    const credits = input.projectInput.batchCount * AD_SCRIPT_CREDITS_PER_VARIANT;
    this.db.transaction(
      (tx) => {
        const user = tx.select().from(users).where(eq(users.id, input.ownerUserId)).get();
        if (!user || user.credits < credits) throw new InsufficientCreditsError("创作点不足");
        const balance = user.credits - credits;
        tx.insert(jobs).values(jobValues(input.job)).run();
        tx.update(users)
          .set({ credits: balance, updatedAt: input.job.createdAt })
          .where(eq(users.id, input.ownerUserId))
          .run();
        tx.insert(creditCharges)
          .values({
            id: crypto.randomUUID(),
            userId: input.ownerUserId,
            jobId: input.job.id,
            amount: credits,
            balanceAfter: balance,
            createdAt: input.job.createdAt,
          })
          .run();
        tx.insert(adScriptProjects)
          .values({
            id: input.projectId,
            ownerUserId: input.ownerUserId,
            jobId: input.job.id,
            status: "queued",
            input: input.projectInput,
            idempotencyKey: input.idempotencyKey,
            createdAt: input.job.createdAt,
            updatedAt: input.job.createdAt,
          })
          .run();
        tx.insert(adScriptVariants)
          .values(
            Array.from({ length: input.projectInput.batchCount }, (_, index) => ({
              id: crypto.randomUUID(),
              projectId: input.projectId,
              ordinal: index + 1,
              status: "queued" as const,
              createdAt: input.job.createdAt,
              updatedAt: input.job.createdAt,
            })),
          )
          .run();
      },
      { behavior: "immediate" },
    );
    const created = this.getOwned(input.projectId, input.ownerUserId);
    if (!created) throw new Error("AD_SCRIPT_PROJECT_CREATE_FAILED");
    return created;
  }

  updateProject(projectId: string, patch: Partial<Pick<ProjectRow, "status" | "input" | "jobId">>) {
    this.db
      .update(adScriptProjects)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(adScriptProjects.id, projectId))
      .run();
  }

  updateVariant(
    variantId: string,
    patch: Partial<
      Pick<VariantRow, "status" | "currentVersionId" | "finalScore" | "compliancePassed" | "iterationCount" | "error">
    >,
  ) {
    this.db
      .update(adScriptVariants)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(adScriptVariants.id, variantId))
      .run();
  }

  appendVersion(input: {
    variantId: string;
    source: VersionRow["source"];
    parentVersionId?: string;
    round: number;
    script: string;
    score: AdScriptScoreDetail;
    compliance: AdScriptCompliance;
    changeSummary: string;
  }) {
    return this.db.transaction(
      (tx) => {
        const nextSequence =
          (tx
            .select({ value: max(adScriptVersions.sequence) })
            .from(adScriptVersions)
            .where(eq(adScriptVersions.variantId, input.variantId))
            .get()?.value ?? 0) + 1;
        const version: typeof adScriptVersions.$inferInsert = {
          id: crypto.randomUUID(),
          variantId: input.variantId,
          sequence: nextSequence,
          source: input.source,
          parentVersionId: input.parentVersionId,
          round: input.round,
          script: input.script,
          score: input.score,
          compliance: input.compliance,
          changeSummary: input.changeSummary,
          model: input.source === "human" ? "human" : AD_SCRIPT_MODEL,
          createdAt: new Date().toISOString(),
        };
        tx.insert(adScriptVersions).values(version).run();
        tx.update(adScriptVariants)
          .set({
            currentVersionId: version.id,
            finalScore: version.score.total,
            compliancePassed: version.compliance.passed,
            iterationCount: input.round,
            updatedAt: version.createdAt,
          })
          .where(eq(adScriptVariants.id, input.variantId))
          .run();
        return version as VersionRow;
      },
      { behavior: "immediate" },
    );
  }

  saveHumanVersion(input: {
    projectId: string;
    variantId: string;
    ownerUserId: string;
    expectedVersionId: string;
    script: string;
    score: AdScriptScoreDetail;
    compliance: AdScriptCompliance;
  }) {
    const aggregate = this.getOwned(input.projectId, input.ownerUserId);
    const variant = aggregate?.variants.find((item) => item.id === input.variantId);
    if (!variant) return undefined;
    if (variant.currentVersionId !== input.expectedVersionId)
      throw new AdScriptVersionConflictError("脚本已产生新版本，请刷新后再保存");
    return this.appendVersion({
      variantId: input.variantId,
      source: "human",
      parentVersionId: input.expectedVersionId,
      round: variant.iterationCount,
      script: input.script,
      score: input.score,
      compliance: input.compliance,
      changeSummary: "人工编辑",
    });
  }

  refundFullyFailed(jobId: string, reason = "口播脚本整批生成失败") {
    return this.db.transaction(
      (tx) => {
        const existing = tx.select().from(creditRefunds).where(eq(creditRefunds.jobId, jobId)).get();
        if (existing) return existing;
        const charge = tx.select().from(creditCharges).where(eq(creditCharges.jobId, jobId)).get();
        if (!charge) return undefined;
        const project = tx.select().from(adScriptProjects).where(eq(adScriptProjects.jobId, jobId)).get();
        if (project?.status !== "failed") return undefined;
        const succeeded = tx
          .select({ id: adScriptVariants.id })
          .from(adScriptVariants)
          .where(and(eq(adScriptVariants.projectId, project.id), eq(adScriptVariants.status, "succeeded")))
          .get();
        if (succeeded) return undefined;
        const user = tx.select().from(users).where(eq(users.id, charge.userId)).get();
        if (!user) return undefined;
        const createdAt = new Date().toISOString();
        const balanceAfter = user.credits + charge.amount;
        tx.update(users).set({ credits: balanceAfter, updatedAt: createdAt }).where(eq(users.id, user.id)).run();
        const refund: typeof creditRefunds.$inferInsert = {
          id: crypto.randomUUID(),
          userId: user.id,
          jobId,
          amount: charge.amount,
          balanceAfter,
          reason,
          createdAt,
        };
        tx.insert(creditRefunds).values(refund).run();
        return refund;
      },
      { behavior: "immediate" },
    );
  }

  private aggregate(project: ProjectRow): AdScriptAggregate {
    const variants = this.db
      .select()
      .from(adScriptVariants)
      .where(eq(adScriptVariants.projectId, project.id))
      .orderBy(asc(adScriptVariants.ordinal))
      .all();
    const versionsByVariant = new Map<string, VersionRow[]>();
    for (const variant of variants)
      versionsByVariant.set(
        variant.id,
        this.db
          .select()
          .from(adScriptVersions)
          .where(eq(adScriptVersions.variantId, variant.id))
          .orderBy(asc(adScriptVersions.sequence))
          .all(),
      );
    return {
      project,
      variants: variants.map((variant) => ({ ...variant, versions: versionsByVariant.get(variant.id) ?? [] })),
    };
  }
}
