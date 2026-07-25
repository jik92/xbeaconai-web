import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderGenerationAuditStore } from "../../server/audit/provider-generation-audit-store";
import type { JobRecord } from "../../server/types";
import { syncProviderGenerationAudits } from "../../worker/jobs/provider-audit";
import { createTestAccountStore, registerTestAccount } from "./account-test-helper";

const databases: string[] = [];

afterEach(() => {
  for (const path of databases.splice(0)) {
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});

function job(ownerUserId: string, patch: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-provider-audit",
    ownerUserId,
    moduleId: "ai-generate",
    title: "生成商品视频",
    status: "succeeded",
    progress: 100,
    stage: "生成完成",
    overallExecutionMode: "real",
    values: { prompt: "模特展示商品", apiKey: "request-secret" },
    executionPlan: [],
    provenance: [
      {
        id: "job-provider-audit:video-generate",
        capability: "video-generate",
        executionMode: "real",
        implementation: "seedance-task-api",
        provider: "aihubmix",
        model: "seedance-1-5-pro",
        startedAt: "2026-07-26T02:00:00.000Z",
        completedAt: "2026-07-26T02:00:04.000Z",
      },
    ],
    result: {
      kind: "video",
      title: "商品视频",
      summary: "生成完成",
      artifacts: [
        {
          id: "asset-video-1",
          name: "result.mp4",
          mimeType: "video/mp4",
          executionMode: "real",
          lineage: [],
        },
      ],
      data: { values: {}, generatedAt: "2026-07-26T02:00:04.000Z", mock: false },
    },
    cancelRequested: false,
    providerTaskId: "provider-task-video",
    providerStatus: "succeeded",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt: "2026-07-26T01:59:59.000Z",
    updatedAt: "2026-07-26T02:00:04.000Z",
    ...patch,
  };
}

describe("worker provider audit synchronization", () => {
  test("records every real provider stage with original parameters, user, and generated assets", async () => {
    const path = join(tmpdir(), `provider-audit-worker-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const accounts = createTestAccountStore(path);
    const member = await registerTestAccount(accounts, {
      phone: "13800000121",
      password: "Password123",
      displayName: "视频用户",
    });
    const audits = new ProviderGenerationAuditStore(path);

    syncProviderGenerationAudits(audits, job(member.user.id));

    expect(audits.list({ page: 1, pageSize: 10 })).toMatchObject({
      total: 1,
      audits: [
        {
          userPhone: "13800000121",
          capability: "video-generate",
          provider: "aihubmix",
          model: "seedance-1-5-pro",
          providerTaskId: "provider-task-video",
          status: "succeeded",
          assetCount: 1,
          durationMs: 4000,
        },
      ],
    });
    const firstAudit = audits.list({ page: 1, pageSize: 10 }).audits[0];
    expect(firstAudit).toBeDefined();
    if (!firstAudit) throw new Error("Expected one Provider audit");
    const audit = audits.get(firstAudit.id);
    expect(audit?.requestPayload).toEqual({ prompt: "模特展示商品", apiKey: "[REDACTED]" });
    expect(audit?.assetIds).toEqual(["asset-video-1"]);

    audits.close();
    accounts.close();
  });

  test("does not create third-party audits for local or mock stages", async () => {
    const path = join(tmpdir(), `provider-audit-worker-mock-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const accounts = createTestAccountStore(path);
    const member = await registerTestAccount(accounts, {
      phone: "13800000122",
      password: "Password123",
      displayName: "Mock 用户",
    });
    const audits = new ProviderGenerationAuditStore(path);
    const mock = job(member.user.id, {
      overallExecutionMode: "mock",
      provenance: [
        {
          id: "job-provider-audit:video-generate",
          capability: "video-generate",
          executionMode: "mock",
          implementation: "local-mock",
          startedAt: "2026-07-26T02:00:00.000Z",
          completedAt: "2026-07-26T02:00:01.000Z",
        },
      ],
    });

    syncProviderGenerationAudits(audits, mock);

    expect(audits.list({ page: 1, pageSize: 10 }).total).toBe(0);
    audits.close();
    accounts.close();
  });

  test("stores structured failures and cancellations from real providers", async () => {
    const path = join(tmpdir(), `provider-audit-worker-failure-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const accounts = createTestAccountStore(path);
    const member = await registerTestAccount(accounts, {
      phone: "13800000123",
      password: "Password123",
      displayName: "失败用户",
    });
    const audits = new ProviderGenerationAuditStore(path);
    const failed = job(member.user.id, {
      status: "failed",
      result: undefined,
      error: { code: "PROVIDER_TIMEOUT", message: "上游超时", retryable: true, requestId: "request-failed" },
    });

    syncProviderGenerationAudits(audits, failed);

    const firstAudit = audits.list({ page: 1, pageSize: 10 }).audits[0];
    if (!firstAudit) throw new Error("Expected one failed Provider audit");
    const audit = audits.get(firstAudit.id);
    expect(audit).toMatchObject({
      status: "failed",
      providerRequestId: "request-failed",
      errorPayload: { code: "PROVIDER_TIMEOUT", message: "上游超时", retryable: true, requestId: "request-failed" },
      assetIds: [],
    });
    audits.close();
    accounts.close();
  });

  test("updates one visible audit from in-flight processing to terminal success", async () => {
    const path = join(tmpdir(), `provider-audit-worker-progress-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const accounts = createTestAccountStore(path);
    const member = await registerTestAccount(accounts, {
      phone: "13800000124",
      password: "Password123",
      displayName: "处理中用户",
    });
    const audits = new ProviderGenerationAuditStore(path);
    const processing = job(member.user.id, {
      status: "processing",
      progress: 30,
      result: undefined,
      provenance: [
        {
          id: "job-provider-audit:video-generate",
          capability: "video-generate",
          executionMode: "real",
          implementation: "seedance-task-api",
          provider: "aihubmix",
          model: "seedance-1-5-pro",
          startedAt: "2026-07-26T02:00:00.000Z",
        },
      ],
    });

    syncProviderGenerationAudits(audits, processing);
    expect(audits.list({ page: 1, pageSize: 10 })).toMatchObject({
      total: 1,
      audits: [{ status: "processing", assetCount: 0 }],
    });

    syncProviderGenerationAudits(audits, job(member.user.id));
    expect(audits.list({ page: 1, pageSize: 10 })).toMatchObject({
      total: 1,
      audits: [{ status: "succeeded", assetCount: 1 }],
    });
    audits.close();
    accounts.close();
  });
});
