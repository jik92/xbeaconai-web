import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../server/db/database";
import { adminCreditGrants, creditCharges, creditRefunds, jobs, rechargeOrders } from "../../server/db/schema";
import type { JobRecord } from "../../server/types";
import { createTestAccountStore, registerTestAccount } from "./account-test-helper";

const databases: string[] = [];
afterEach(() => {
  for (const path of databases.splice(0)) {
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});

describe("AI billing records", () => {
  test("merges owned recharge, charge, and refund sources with stable pagination", async () => {
    const path = join(tmpdir(), `ai-billing-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const accounts = createTestAccountStore(path);
    const owner = await registerTestAccount(accounts, {
      phone: "13800000031",
      password: "Password123",
      displayName: "账单用户",
    });
    const other = await registerTestAccount(accounts, {
      phone: "13800000032",
      password: "Password123",
      displayName: "其他用户",
    });
    const connection = openDatabase(path);
    const jobId = crypto.randomUUID();
    const orphanJobId = crypto.randomUUID();
    const job: JobRecord = {
      id: jobId,
      ownerUserId: owner.user.id,
      moduleId: "video-create",
      title: "夏日商品成片",
      status: "failed",
      progress: 100,
      stage: "生成失败",
      overallExecutionMode: "real",
      values: {},
      executionPlan: [],
      provenance: [],
      cancelRequested: false,
      providerCancelState: "none",
      stagingKeys: [],
      jobSchemaVersion: 2,
      createdAt: "2026-07-26T02:00:00.000Z",
      updatedAt: "2026-07-26T04:00:00.000Z",
    };
    connection.db.insert(jobs).values(job).run();
    connection.db
      .insert(rechargeOrders)
      .values([
        {
          id: crypto.randomUUID(),
          userId: owner.user.id,
          idempotencyKey: "owner-recharge",
          packageId: "starter",
          amountCny: 19,
          credits: 1000,
          balanceAfter: 3480,
          requestFingerprint: `${owner.user.id}:starter`,
          status: "succeeded",
          createdAt: "2026-07-26T01:00:00.000Z",
          completedAt: "2026-07-26T01:00:00.000Z",
        },
        {
          id: crypto.randomUUID(),
          userId: other.user.id,
          idempotencyKey: "other-recharge",
          packageId: "starter",
          amountCny: 19,
          credits: 1000,
          balanceAfter: 3480,
          requestFingerprint: `${other.user.id}:starter`,
          status: "succeeded",
          createdAt: "2026-07-26T06:00:00.000Z",
          completedAt: "2026-07-26T06:00:00.000Z",
        },
      ])
      .run();
    connection.db
      .insert(adminCreditGrants)
      .values({
        id: crypto.randomUUID(),
        userId: owner.user.id,
        adminUserId: other.user.id,
        idempotencyKey: "admin-recharge",
        requestFingerprint: `${owner.user.id}:500`,
        credits: 500,
        balanceAfter: 3980,
        createdAt: "2026-07-26T05:00:00.000Z",
      })
      .run();
    connection.db
      .insert(creditCharges)
      .values([
        {
          id: crypto.randomUUID(),
          userId: owner.user.id,
          jobId,
          amount: 12,
          balanceAfter: 3968,
          createdAt: "2026-07-26T03:00:00.000Z",
        },
        {
          id: crypto.randomUUID(),
          userId: owner.user.id,
          jobId: orphanJobId,
          amount: 4,
          balanceAfter: 3964,
          createdAt: "2026-07-26T02:00:00.000Z",
        },
        {
          id: crypto.randomUUID(),
          userId: other.user.id,
          jobId: crypto.randomUUID(),
          amount: 99,
          balanceAfter: 1,
          createdAt: "2026-07-26T07:00:00.000Z",
        },
      ])
      .run();
    connection.db
      .insert(creditRefunds)
      .values({
        id: crypto.randomUUID(),
        userId: owner.user.id,
        jobId,
        amount: 12,
        balanceAfter: 3976,
        reason: "任务整批生成失败",
        createdAt: "2026-07-26T04:00:00.000Z",
      })
      .run();

    const rechargePage = accounts.listAiRechargeRecords(owner.user.id, { page: 1, pageSize: 10 });
    expect(rechargePage.total).toBe(2);
    expect(rechargePage.records.map((record) => record.source)).toEqual(["admin_grant", "mock_recharge"]);
    expect(rechargePage.records[0]?.amountCny).toBeUndefined();
    expect(rechargePage.records[1]?.amountCny).toBe(19);

    const consumptionPage = accounts.listAiConsumptionRecords(owner.user.id, { page: 1, pageSize: 2 });
    expect(consumptionPage.total).toBe(3);
    expect(consumptionPage.records).toMatchObject([
      {
        type: "refund",
        moduleId: "video-create",
        jobTitle: "夏日商品成片",
        creditChange: 12,
        note: "任务整批生成失败",
      },
      { type: "charge", moduleId: "video-create", jobTitle: "夏日商品成片", creditChange: -12 },
    ]);
    expect(accounts.listAiConsumptionRecords(owner.user.id, { page: 2, pageSize: 2 }).records).toMatchObject([
      { type: "charge", jobId: orphanJobId, creditChange: -4 },
    ]);
    expect(accounts.listAiConsumptionRecords(other.user.id, { page: 1, pageSize: 10 }).total).toBe(1);

    connection.client.close();
    accounts.close();
  });
});
