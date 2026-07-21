import { and, asc, count, desc, eq, inArray, like, lte, type SQL } from "drizzle-orm";
import type { ModuleId } from "../../web/entities/types";
import { type AppDatabase, openDatabase } from "../db/database";
import { creditCharges, jobs, objectCleanup, users } from "../db/schema";
import { env } from "../env";
import type { JobRecord } from "../types";

type JobRow = typeof jobs.$inferSelect;
export class InsufficientCreditsError extends Error {}

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

export class SqliteJobStore {
  readonly db: AppDatabase;
  private readonly client: ReturnType<typeof openDatabase>["client"];

  constructor(path = env.databasePath) {
    const connection = openDatabase(path);
    this.client = connection.client;
    this.db = connection.db;
    this.retireWanJobs();
  }

  close() {
    this.client.close();
  }

  private retireWanJobs() {
    const timestamp = new Date().toISOString();
    const error = {
      code: "MODEL_RETIRED",
      message: "Wan 已停止支持，请重新选择 Seedance 模型创建任务",
      retryable: false,
      requestId: crypto.randomUUID(),
    };
    const retired = this.db
      .select({ id: jobs.id, executionPlan: jobs.executionPlan, provenance: jobs.provenance })
      .from(jobs)
      .where(inArray(jobs.status, ["queued", "processing"]))
      .all()
      .filter((job) => JSON.stringify([job.executionPlan, job.provenance]).includes("wan2.6-t2v"));
    if (!retired.length) return;
    this.db
      .update(jobs)
      .set({ status: "failed", stage: "模型已停用", error, updatedAt: timestamp })
      .where(
        inArray(
          jobs.id,
          retired.map((job) => job.id),
        ),
      )
      .run();
  }

  private fromRow(row: JobRow): JobRecord {
    return {
      id: row.id,
      ownerUserId: row.ownerUserId ?? "legacy",
      moduleId: row.moduleId,
      title: row.title,
      status: row.status,
      progress: row.progress,
      stage: row.stage,
      overallExecutionMode: row.overallExecutionMode,
      values: row.values,
      videoModel: row.videoModel ?? undefined,
      executionPlan: row.executionPlan,
      provenance: row.provenance,
      result: row.result ?? undefined,
      error: row.error ?? undefined,
      parentJobId: row.parentJobId ?? undefined,
      idempotencyKey: row.idempotencyKey ?? undefined,
      cancelRequested: row.cancelRequested,
      providerModel: row.providerModel ?? undefined,
      providerTaskId: row.providerTaskId ?? undefined,
      providerStatus: row.providerStatus ?? undefined,
      providerSubmittedAt: row.providerSubmittedAt ?? undefined,
      providerDeadlineAt: row.providerDeadlineAt ?? undefined,
      providerCancelState: row.providerCancelState ?? undefined,
      stagingKeys: row.stagingKeys,
      jobSchemaVersion: row.jobSchemaVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  create(job: JobRecord): JobRecord {
    this.db.insert(jobs).values(jobValues(job)).run();
    return job;
  }

  createCharged(job: JobRecord, credits: number): JobRecord {
    if (!Number.isInteger(credits) || credits <= 0) return this.create(job);
    return this.db.transaction(
      (tx) => {
        const user = tx.select().from(users).where(eq(users.id, job.ownerUserId)).get();
        if (!user || user.credits < credits) throw new InsufficientCreditsError("创作点不足");
        const balance = user.credits - credits;
        tx.insert(jobs).values(jobValues(job)).run();
        tx.update(users).set({ credits: balance, updatedAt: job.createdAt }).where(eq(users.id, job.ownerUserId)).run();
        tx.insert(creditCharges)
          .values({
            id: crypto.randomUUID(),
            userId: job.ownerUserId,
            jobId: job.id,
            amount: credits,
            balanceAfter: balance,
            createdAt: job.createdAt,
          })
          .run();
        return job;
      },
      { behavior: "immediate" },
    );
  }

  get(id: string): JobRecord | undefined {
    const row = this.db.select().from(jobs).where(eq(jobs.id, id)).get();
    return row ? this.fromRow(row) : undefined;
  }

  getOwned(id: string, ownerUserId: string): JobRecord | undefined {
    const row = this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, id), eq(jobs.ownerUserId, ownerUserId)))
      .get();
    return row ? this.fromRow(row) : undefined;
  }

  getByIdempotencyKey(ownerUserId: string, key: string): JobRecord | undefined {
    const row = this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.ownerUserId, ownerUserId), eq(jobs.idempotencyKey, key)))
      .get();
    return row ? this.fromRow(row) : undefined;
  }

  list(ownerUserId: string, moduleId?: ModuleId): JobRecord[] {
    const condition = moduleId
      ? and(eq(jobs.ownerUserId, ownerUserId), eq(jobs.moduleId, moduleId))
      : eq(jobs.ownerUserId, ownerUserId);
    return this.db
      .select()
      .from(jobs)
      .where(condition)
      .orderBy(desc(jobs.createdAt))
      .limit(100)
      .all()
      .map((row) => this.fromRow(row));
  }

  listAll(input: {
    page: number;
    pageSize: number;
    moduleId?: ModuleId;
    status?: JobRecord["status"];
    email?: string;
  }) {
    const conditions: SQL[] = [];
    if (input.moduleId) conditions.push(eq(jobs.moduleId, input.moduleId));
    if (input.status) conditions.push(eq(jobs.status, input.status));
    if (input.email?.trim()) conditions.push(like(users.email, `%${input.email.trim().toLowerCase()}%`));
    const where = conditions.length ? and(...conditions) : undefined;
    const rows = this.db
      .select({ job: jobs, ownerEmail: users.email })
      .from(jobs)
      .leftJoin(users, eq(jobs.ownerUserId, users.id))
      .where(where)
      .orderBy(desc(jobs.createdAt))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize)
      .all();
    const total =
      this.db.select({ value: count() }).from(jobs).leftJoin(users, eq(jobs.ownerUserId, users.id)).where(where).get()
        ?.value ?? 0;
    return {
      jobs: rows.map((row) => ({ ...this.fromRow(row.job), ownerEmail: row.ownerEmail ?? "legacy" })),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  recoverable(): JobRecord[] {
    return this.db
      .select()
      .from(jobs)
      .where(inArray(jobs.status, ["queued", "processing"]))
      .orderBy(asc(jobs.createdAt))
      .all()
      .map((row) => this.fromRow(row));
  }

  update(id: string, patch: Partial<JobRecord>): JobRecord | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.db
      .update(jobs)
      .set({
        status: next.status,
        progress: next.progress,
        stage: next.stage,
        overallExecutionMode: next.overallExecutionMode,
        values: next.values,
        videoModel: next.videoModel,
        executionPlan: next.executionPlan,
        provenance: next.provenance,
        result: next.result,
        error: next.error,
        cancelRequested: next.cancelRequested,
        providerModel: next.providerModel,
        providerTaskId: next.providerTaskId,
        providerStatus: next.providerStatus,
        providerSubmittedAt: next.providerSubmittedAt,
        providerDeadlineAt: next.providerDeadlineAt,
        providerCancelState: next.providerCancelState ?? "none",
        stagingKeys: next.stagingKeys,
        jobSchemaVersion: next.jobSchemaVersion,
        updatedAt: next.updatedAt,
      })
      .where(eq(jobs.id, id))
      .run();
    return next;
  }

  scheduleObjectCleanup(jobId: string, key: string, error: unknown) {
    const timestamp = new Date().toISOString();
    this.db.transaction(
      (tx) => {
        const existing = tx.select().from(objectCleanup).where(eq(objectCleanup.objectKey, key)).get();
        if (existing) {
          tx.update(objectCleanup)
            .set({ attempts: existing.attempts + 1, lastError: String(error).slice(0, 500), nextAttemptAt: timestamp })
            .where(eq(objectCleanup.objectKey, key))
            .run();
          return;
        }
        tx.insert(objectCleanup)
          .values({
            objectKey: key,
            jobId,
            attempts: 1,
            lastError: String(error).slice(0, 500),
            nextAttemptAt: timestamp,
            createdAt: timestamp,
          })
          .run();
      },
      { behavior: "immediate" },
    );
  }
  pendingObjectCleanup() {
    return this.db
      .select()
      .from(objectCleanup)
      .where(lte(objectCleanup.nextAttemptAt, new Date().toISOString()))
      .orderBy(asc(objectCleanup.createdAt))
      .limit(100)
      .all()
      .map((row) => ({ object_key: row.objectKey, job_id: row.jobId, attempts: row.attempts }));
  }
  completeObjectCleanup(key: string) {
    this.db.delete(objectCleanup).where(eq(objectCleanup.objectKey, key)).run();
  }
  deferObjectCleanup(key: string, error: unknown, attempts: number) {
    const delay = Math.min(60 * 60_000, 2 ** Math.min(attempts, 8) * 5_000);
    this.db
      .update(objectCleanup)
      .set({
        attempts: attempts + 1,
        lastError: String(error).slice(0, 500),
        nextAttemptAt: new Date(Date.now() + delay).toISOString(),
      })
      .where(eq(objectCleanup.objectKey, key))
      .run();
  }
}
