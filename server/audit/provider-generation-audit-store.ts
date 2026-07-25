import { and, count, desc, eq, gte, like, lte, or, type SQL } from "drizzle-orm";
import { type AppDatabase, openDatabase } from "../db/database";
import { providerGenerationAudits, users } from "../db/schema";
import { env } from "../env";

export type ProviderAuditStatus = "submitting" | "processing" | "succeeded" | "failed" | "cancelled";

export interface ProviderGenerationAuditSummary {
  id: string;
  jobId: string;
  ownerUserId: string;
  userPhone?: string;
  userDisplayName?: string;
  moduleId: string;
  capability: string;
  provider: string;
  model?: string;
  operation: string;
  providerTaskId?: string;
  providerRequestId?: string;
  status: ProviderAuditStatus;
  assetCount: number;
  submittedAt: string;
  completedAt?: string;
  durationMs?: number;
}

export interface ProviderGenerationAuditDetail extends ProviderGenerationAuditSummary {
  requestPayload: unknown;
  responsePayload?: unknown;
  errorPayload?: unknown;
  assetIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BeginProviderGenerationAuditInput {
  jobId: string;
  ownerUserId: string;
  moduleId: string;
  capability: string;
  provider: string;
  model?: string;
  operation: string;
  requestPayload: unknown;
  submittedAt?: string;
}

export interface ProgressProviderGenerationAuditInput {
  auditId: string;
  providerTaskId?: string;
  providerRequestId?: string;
  status?: "submitting" | "processing";
}

export interface CompleteProviderGenerationAuditInput {
  auditId: string;
  status: "succeeded" | "failed" | "cancelled";
  responsePayload?: unknown;
  errorPayload?: unknown;
  assetIds?: string[];
  providerTaskId?: string;
  providerRequestId?: string;
  completedAt?: string;
}

export interface ProviderGenerationAuditListInput {
  page: number;
  pageSize: number;
  query?: string;
  provider?: string;
  moduleId?: string;
  status?: ProviderAuditStatus;
  startedFrom?: string;
  startedTo?: string;
}

const sensitiveKeyPattern =
  /^(authorization|proxyauthorization|token|accesstoken|refreshtoken|idtoken|secret|clientsecret|password|passwd|apikey|accesskey|secretkey|signature|credential|cookie|setcookie)$/i;
const redacted = "[REDACTED]";

function shouldRedactKey(key: string) {
  return sensitiveKeyPattern.test(key.replaceAll(/[-_\s]/g, ""));
}

function redactUrl(value: string) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) if (shouldRedactKey(key)) url.searchParams.set(key, redacted);
    return url.toString();
  } catch {
    return value
      .replace(/(\bauthorization\s*:\s*bearer\s+)[^\s,;]+/gi, `$1${redacted}`)
      .replace(/(\b(?:api[_-]?key|access[_-]?token|secret[_-]?key|signature)\s*[=:]\s*)[^\s,;&]+/gi, `$1${redacted}`);
  }
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return redactUrl(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof URL) return redactUrl(value.toString());
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value))
    result[key] = shouldRedactKey(key) ? redacted : redactValue(item, seen);
  seen.delete(value);
  return result;
}

export function redactAuditPayload(value: unknown): unknown {
  return redactValue(value, new WeakSet());
}

type AuditRow = typeof providerGenerationAudits.$inferSelect;
type JoinedAuditRow = { audit: AuditRow; userPhone: string | null; userDisplayName: string | null };

function summary(row: JoinedAuditRow): ProviderGenerationAuditSummary {
  return {
    id: row.audit.id,
    jobId: row.audit.jobId,
    ownerUserId: row.audit.ownerUserId,
    userPhone: row.userPhone ?? undefined,
    userDisplayName: row.userDisplayName ?? undefined,
    moduleId: row.audit.moduleId,
    capability: row.audit.capability,
    provider: row.audit.provider,
    model: row.audit.model ?? undefined,
    operation: row.audit.operation,
    providerTaskId: row.audit.providerTaskId ?? undefined,
    providerRequestId: row.audit.providerRequestId ?? undefined,
    status: row.audit.status,
    assetCount: row.audit.assetIds.length,
    submittedAt: row.audit.submittedAt,
    completedAt: row.audit.completedAt ?? undefined,
    durationMs: row.audit.durationMs ?? undefined,
  };
}

function detail(row: JoinedAuditRow): ProviderGenerationAuditDetail {
  return {
    ...summary(row),
    requestPayload: row.audit.requestPayload,
    responsePayload: row.audit.responsePayload ?? undefined,
    errorPayload: row.audit.errorPayload ?? undefined,
    assetIds: row.audit.assetIds,
    createdAt: row.audit.createdAt,
    updatedAt: row.audit.updatedAt,
  };
}

export class ProviderGenerationAuditStore {
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

  private joined(id: string) {
    return this.db
      .select({
        audit: providerGenerationAudits,
        userPhone: users.phone,
        userDisplayName: users.displayName,
      })
      .from(providerGenerationAudits)
      .leftJoin(users, eq(providerGenerationAudits.ownerUserId, users.id))
      .where(eq(providerGenerationAudits.id, id))
      .get();
  }

  begin(input: BeginProviderGenerationAuditInput): ProviderGenerationAuditDetail {
    const timestamp = input.submittedAt ?? new Date().toISOString();
    const id = crypto.randomUUID();
    this.db
      .insert(providerGenerationAudits)
      .values({
        id,
        jobId: input.jobId,
        ownerUserId: input.ownerUserId,
        moduleId: input.moduleId,
        capability: input.capability,
        provider: input.provider,
        model: input.model,
        operation: input.operation,
        status: "submitting",
        requestPayload: redactAuditPayload(input.requestPayload),
        submittedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoNothing({
        target: [
          providerGenerationAudits.jobId,
          providerGenerationAudits.capability,
          providerGenerationAudits.operation,
        ],
      })
      .run();
    const row = this.db
      .select({ id: providerGenerationAudits.id })
      .from(providerGenerationAudits)
      .where(
        and(
          eq(providerGenerationAudits.jobId, input.jobId),
          eq(providerGenerationAudits.capability, input.capability),
          eq(providerGenerationAudits.operation, input.operation),
        ),
      )
      .get();
    const joined = row ? this.joined(row.id) : undefined;
    if (!joined) throw new Error("Provider generation audit could not be created");
    return detail(joined);
  }

  progress(input: ProgressProviderGenerationAuditInput) {
    this.db
      .update(providerGenerationAudits)
      .set({
        providerTaskId: input.providerTaskId,
        providerRequestId: input.providerRequestId,
        status: input.status ?? "processing",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(providerGenerationAudits.id, input.auditId))
      .run();
    const row = this.joined(input.auditId);
    return row ? detail(row) : undefined;
  }

  complete(input: CompleteProviderGenerationAuditInput) {
    const current = this.db
      .select({ submittedAt: providerGenerationAudits.submittedAt })
      .from(providerGenerationAudits)
      .where(eq(providerGenerationAudits.id, input.auditId))
      .get();
    if (!current) return undefined;
    const completedAt = input.completedAt ?? new Date().toISOString();
    this.db
      .update(providerGenerationAudits)
      .set({
        status: input.status,
        responsePayload: input.responsePayload === undefined ? undefined : redactAuditPayload(input.responsePayload),
        errorPayload: input.errorPayload === undefined ? undefined : redactAuditPayload(input.errorPayload),
        assetIds: input.assetIds ?? [],
        providerTaskId: input.providerTaskId,
        providerRequestId: input.providerRequestId,
        completedAt,
        durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(current.submittedAt).getTime()),
        updatedAt: completedAt,
      })
      .where(eq(providerGenerationAudits.id, input.auditId))
      .run();
    const row = this.joined(input.auditId);
    return row ? detail(row) : undefined;
  }

  list(input: ProviderGenerationAuditListInput) {
    const conditions: SQL[] = [];
    const query = input.query?.trim();
    if (query) {
      const pattern = `%${query}%`;
      const searchCondition = or(
        like(users.phone, pattern),
        like(users.displayName, pattern),
        like(providerGenerationAudits.jobId, pattern),
        like(providerGenerationAudits.providerTaskId, pattern),
      );
      if (searchCondition) conditions.push(searchCondition);
    }
    if (input.provider) conditions.push(eq(providerGenerationAudits.provider, input.provider));
    if (input.moduleId) conditions.push(eq(providerGenerationAudits.moduleId, input.moduleId));
    if (input.status) conditions.push(eq(providerGenerationAudits.status, input.status));
    if (input.startedFrom) conditions.push(gte(providerGenerationAudits.submittedAt, input.startedFrom));
    if (input.startedTo) conditions.push(lte(providerGenerationAudits.submittedAt, input.startedTo));
    const where = conditions.length ? and(...conditions) : undefined;
    const base = this.db
      .select({
        audit: providerGenerationAudits,
        userPhone: users.phone,
        userDisplayName: users.displayName,
      })
      .from(providerGenerationAudits)
      .leftJoin(users, eq(providerGenerationAudits.ownerUserId, users.id));
    const rows = (where ? base.where(where) : base)
      .orderBy(desc(providerGenerationAudits.submittedAt))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize)
      .all();
    const countBase = this.db
      .select({ total: count() })
      .from(providerGenerationAudits)
      .leftJoin(users, eq(providerGenerationAudits.ownerUserId, users.id));
    const total = (where ? countBase.where(where) : countBase).get()?.total ?? 0;
    return { audits: rows.map(summary), total, page: input.page, pageSize: input.pageSize };
  }

  get(id: string) {
    const row = this.joined(id);
    return row ? detail(row) : undefined;
  }
}
