import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderGenerationAuditStore, redactAuditPayload } from "../../server/audit/provider-generation-audit-store";
import { createTestAccountStore, registerTestAccount } from "./account-test-helper";

const databases: string[] = [];

afterEach(() => {
  for (const path of databases.splice(0)) {
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});

describe("provider generation audit store", () => {
  test("redacts nested credentials and sensitive URL query values while preserving generation parameters", () => {
    expect(
      redactAuditPayload({
        apiKey: "secret",
        prompt: "保留完整提示词",
        nested: { authorization: "Bearer abc", model: "seedance-1-5-pro" },
        url: "https://provider.test/generate?token=abc&model=seedance",
        message: "upstream rejected Authorization: Bearer leaked-value",
      }),
    ).toEqual({
      apiKey: "[REDACTED]",
      prompt: "保留完整提示词",
      nested: { authorization: "[REDACTED]", model: "seedance-1-5-pro" },
      url: "https://provider.test/generate?token=%5BREDACTED%5D&model=seedance",
      message: "upstream rejected Authorization: Bearer [REDACTED]",
    });
  });

  test("aggregates submission, provider progress, and generated assets into one row", async () => {
    const path = join(tmpdir(), `provider-audit-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const accounts = createTestAccountStore(path);
    const member = await registerTestAccount(accounts, {
      phone: "13800000111",
      password: "Password123",
      displayName: "素材创作者",
    });
    const store = new ProviderGenerationAuditStore(path);
    const begun = store.begin({
      jobId: "job-audit-1",
      ownerUserId: member.user.id,
      moduleId: "ai-generate",
      capability: "video-generate",
      provider: "aihubmix",
      model: "seedance-1-5-pro",
      operation: "submit-video",
      requestPayload: { prompt: "完整商品视频", apiKey: "must-not-leak" },
      submittedAt: "2026-07-26T00:00:00.000Z",
    });

    store.progress({
      auditId: begun.id,
      providerTaskId: "provider-task-1",
      providerRequestId: "request-1",
      status: "processing",
    });
    store.complete({
      auditId: begun.id,
      status: "succeeded",
      responsePayload: { status: "done", accessToken: "must-not-leak" },
      assetIds: ["asset-1", "asset-2"],
      completedAt: "2026-07-26T00:00:03.250Z",
    });

    expect(store.get(begun.id)).toMatchObject({
      jobId: "job-audit-1",
      ownerUserId: member.user.id,
      userPhone: "13800000111",
      userDisplayName: "素材创作者",
      status: "succeeded",
      providerTaskId: "provider-task-1",
      providerRequestId: "request-1",
      durationMs: 3250,
      requestPayload: { prompt: "完整商品视频", apiKey: "[REDACTED]" },
      responsePayload: { status: "done", accessToken: "[REDACTED]" },
      assetIds: ["asset-1", "asset-2"],
    });
    expect(store.list({ page: 1, pageSize: 10, provider: "aihubmix", status: "succeeded" })).toMatchObject({
      total: 1,
      audits: [{ id: begun.id, assetCount: 2, userPhone: "13800000111" }],
    });

    store.close();
    accounts.close();
  });

  test("reuses the same job capability and operation audit on worker recovery", async () => {
    const path = join(tmpdir(), `provider-audit-recovery-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const accounts = createTestAccountStore(path);
    const member = await registerTestAccount(accounts, {
      phone: "13800000112",
      password: "Password123",
      displayName: "恢复用户",
    });
    const store = new ProviderGenerationAuditStore(path);
    const input = {
      jobId: "job-recovered",
      ownerUserId: member.user.id,
      moduleId: "video-create",
      capability: "video-generate",
      provider: "aihubmix",
      operation: "generate-shot",
      requestPayload: { prompt: "第一次提交" },
      submittedAt: "2026-07-26T01:00:00.000Z",
    };

    const first = store.begin(input);
    const recovered = store.begin({ ...input, requestPayload: { prompt: "恢复时不覆盖原始提交" } });

    expect(recovered.id).toBe(first.id);
    expect(store.list({ page: 1, pageSize: 10 }).total).toBe(1);
    expect(store.get(first.id)?.requestPayload).toEqual({ prompt: "第一次提交" });

    store.close();
    accounts.close();
  });
});
