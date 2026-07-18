import { Database } from "bun:sqlite";
import { env } from "../env";
import type { JobRecord, JobResult, JobStatus, StageProvenance } from "../types";
import type { ModuleId } from "../../src/entities/types";

interface JobRow {
  id: string;
  owner_user_id: string | null;
  module_id: ModuleId;
  title: string;
  status: JobStatus;
  progress: number;
  stage: string;
  overall_execution_mode: JobRecord["overallExecutionMode"];
  values_json: string;
  video_model: JobRecord["videoModel"] | null;
  execution_plan_json: string;
  provenance_json: string;
  result_json: string | null;
  error_json: string | null;
  parent_job_id: string | null;
  idempotency_key: string | null;
  cancel_requested: number;
  provider_model: JobRecord["providerModel"] | null;
  provider_task_id: string | null;
  provider_status: string | null;
  provider_submitted_at: string | null;
  provider_deadline_at: string | null;
  provider_cancel_state: JobRecord["providerCancelState"] | null;
  staging_keys_json: string | null;
  job_schema_version: 1 | 2 | null;
  created_at: string;
  updated_at: string;
}

const parse = <T>(value: string | null, fallback: T): T => value ? JSON.parse(value) as T : fallback;

export class SqliteJobStore {
  readonly db: Database;

  constructor(path = env.databasePath) {
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        module_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER NOT NULL,
        stage TEXT NOT NULL,
        overall_execution_mode TEXT NOT NULL,
        values_json TEXT NOT NULL,
        execution_plan_json TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        result_json TEXT,
        error_json TEXT,
        parent_job_id TEXT,
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jobs_module_created_idx ON jobs(module_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS jobs_status_created_idx ON jobs(status, created_at ASC);
      CREATE TABLE IF NOT EXISTS object_cleanup (
        object_key TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_attempt_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    const columns = this.db.query("PRAGMA table_info(jobs)").all() as Array<{name:string}>;
    if (!columns.some((column) => column.name === "idempotency_key")) this.db.exec("ALTER TABLE jobs ADD COLUMN idempotency_key TEXT");
    if (!columns.some((column) => column.name === "owner_user_id")) this.db.exec("ALTER TABLE jobs ADD COLUMN owner_user_id TEXT");
    const additions = [
      ["video_model", "TEXT"], ["provider_model", "TEXT"], ["provider_task_id", "TEXT"],
      ["provider_status", "TEXT"], ["provider_submitted_at", "TEXT"], ["provider_deadline_at", "TEXT"],
      ["provider_cancel_state", "TEXT"], ["staging_keys_json", "TEXT NOT NULL DEFAULT '[]'"],
      ["job_schema_version", "INTEGER NOT NULL DEFAULT 1"],
    ] as const;
    for (const [name, definition] of additions) if (!columns.some((column) => column.name === name)) this.db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${definition}`);
    this.db.exec("DROP INDEX IF EXISTS jobs_idempotency_idx; CREATE UNIQUE INDEX jobs_idempotency_idx ON jobs(owner_user_id,idempotency_key) WHERE idempotency_key IS NOT NULL");
    this.retireWanJobs();
  }

  private retireWanJobs() {
    const now = new Date().toISOString();
    const error = JSON.stringify({ code: "MODEL_RETIRED", message: "Wan 已停止支持，请重新选择 Seedance 模型创建任务", retryable: false, requestId: crypto.randomUUID() });
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.query(`UPDATE jobs SET status='failed',stage='模型已停用',error_json=?,updated_at=?
        WHERE status IN ('queued','processing') AND (execution_plan_json LIKE '%wan2.6-t2v%' OR provenance_json LIKE '%wan2.6-t2v%')`).run(error, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private fromRow(row: JobRow): JobRecord {
    return {
      id: row.id,
      ownerUserId: row.owner_user_id ?? "legacy",
      moduleId: row.module_id,
      title: row.title,
      status: row.status,
      progress: row.progress,
      stage: row.stage,
      overallExecutionMode: row.overall_execution_mode,
      values: parse(row.values_json, {}),
      videoModel: row.video_model ?? undefined,
      executionPlan: parse<StageProvenance[]>(row.execution_plan_json, []),
      provenance: parse<StageProvenance[]>(row.provenance_json, []),
      result: parse<JobResult | undefined>(row.result_json, undefined),
      error: parse<JobRecord["error"]>(row.error_json, undefined),
      parentJobId: row.parent_job_id ?? undefined,
      idempotencyKey: row.idempotency_key ?? undefined,
      cancelRequested: Boolean(row.cancel_requested),
      providerModel: row.provider_model ?? undefined,
      providerTaskId: row.provider_task_id ?? undefined,
      providerStatus: row.provider_status ?? undefined,
      providerSubmittedAt: row.provider_submitted_at ?? undefined,
      providerDeadlineAt: row.provider_deadline_at ?? undefined,
      providerCancelState: row.provider_cancel_state ?? undefined,
      stagingKeys: parse(row.staging_keys_json, []),
      jobSchemaVersion: row.job_schema_version ?? 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  create(job: JobRecord): JobRecord {
    this.db.query(`INSERT INTO jobs (
      id,module_id,title,status,progress,stage,overall_execution_mode,values_json,
      execution_plan_json,provenance_json,result_json,error_json,parent_job_id,
      cancel_requested,created_at,updated_at,idempotency_key,owner_user_id,video_model,
      provider_model,provider_task_id,provider_status,provider_submitted_at,provider_deadline_at,
      provider_cancel_state,staging_keys_json,job_schema_version
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      job.id, job.moduleId, job.title, job.status, job.progress, job.stage,
      job.overallExecutionMode, JSON.stringify(job.values), JSON.stringify(job.executionPlan),
      JSON.stringify(job.provenance), job.result ? JSON.stringify(job.result) : null,
      job.error ? JSON.stringify(job.error) : null, job.parentJobId ?? null,
      job.cancelRequested ? 1 : 0, job.createdAt, job.updatedAt, job.idempotencyKey ?? null, job.ownerUserId,
      job.videoModel ?? null, job.providerModel ?? null, job.providerTaskId ?? null, job.providerStatus ?? null,
      job.providerSubmittedAt ?? null, job.providerDeadlineAt ?? null, job.providerCancelState ?? "none",
      JSON.stringify(job.stagingKeys), job.jobSchemaVersion,
    );
    return job;
  }

  get(id: string): JobRecord | undefined {
    const row = this.db.query("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | null;
    return row ? this.fromRow(row) : undefined;
  }

  getOwned(id: string,ownerUserId:string): JobRecord | undefined { const job=this.get(id);return job?.ownerUserId===ownerUserId?job:undefined }

  getByIdempotencyKey(ownerUserId:string,key: string): JobRecord | undefined {
    const row = this.db.query("SELECT * FROM jobs WHERE owner_user_id=? AND idempotency_key = ?").get(ownerUserId,key) as JobRow | null;
    return row ? this.fromRow(row) : undefined;
  }

  list(ownerUserId:string,moduleId?: ModuleId): JobRecord[] {
    const rows = moduleId
      ? this.db.query("SELECT * FROM jobs WHERE owner_user_id=? AND module_id = ? ORDER BY created_at DESC LIMIT 100").all(ownerUserId,moduleId)
      : this.db.query("SELECT * FROM jobs WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 100").all(ownerUserId);
    return (rows as JobRow[]).map((row) => this.fromRow(row));
  }

  recoverable(): JobRecord[] {
    return (this.db.query("SELECT * FROM jobs WHERE status IN ('queued','processing') ORDER BY created_at ASC").all() as JobRow[])
      .map((row) => this.fromRow(row));
  }

  update(id: string, patch: Partial<JobRecord>): JobRecord | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.db.query(`UPDATE jobs SET status=?,progress=?,stage=?,overall_execution_mode=?,values_json=?,video_model=?,
      execution_plan_json=?,provenance_json=?,result_json=?,error_json=?,cancel_requested=?,provider_model=?,
      provider_task_id=?,provider_status=?,provider_submitted_at=?,provider_deadline_at=?,provider_cancel_state=?,
      staging_keys_json=?,job_schema_version=?,updated_at=? WHERE id=?`).run(
      next.status, next.progress, next.stage, next.overallExecutionMode,
      JSON.stringify(next.values), next.videoModel ?? null,
      JSON.stringify(next.executionPlan), JSON.stringify(next.provenance),
      next.result ? JSON.stringify(next.result) : null, next.error ? JSON.stringify(next.error) : null,
      next.cancelRequested ? 1 : 0, next.providerModel ?? null, next.providerTaskId ?? null,
      next.providerStatus ?? null, next.providerSubmittedAt ?? null, next.providerDeadlineAt ?? null,
      next.providerCancelState ?? "none", JSON.stringify(next.stagingKeys), next.jobSchemaVersion, next.updatedAt, id,
    );
    return next;
  }

  scheduleObjectCleanup(jobId:string,key:string,error:unknown){const time=new Date().toISOString();this.db.query(`INSERT INTO object_cleanup(object_key,job_id,attempts,last_error,next_attempt_at,created_at) VALUES(?,?,1,?,?,?) ON CONFLICT(object_key) DO UPDATE SET attempts=attempts+1,last_error=excluded.last_error,next_attempt_at=excluded.next_attempt_at`).run(key,jobId,String(error).slice(0,500),time,time)}
  pendingObjectCleanup(){return this.db.query("SELECT object_key,job_id,attempts FROM object_cleanup WHERE next_attempt_at<=? ORDER BY created_at LIMIT 100").all(new Date().toISOString()) as Array<{object_key:string;job_id:string;attempts:number}>}
  completeObjectCleanup(key:string){this.db.query("DELETE FROM object_cleanup WHERE object_key=?").run(key)}
  deferObjectCleanup(key:string,error:unknown,attempts:number){const delay=Math.min(60*60_000,2**Math.min(attempts,8)*5_000);this.db.query("UPDATE object_cleanup SET attempts=attempts+1,last_error=?,next_attempt_at=? WHERE object_key=?").run(String(error).slice(0,500),new Date(Date.now()+delay).toISOString(),key)}
}
