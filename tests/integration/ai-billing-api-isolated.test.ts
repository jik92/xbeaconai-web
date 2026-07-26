import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { creditCharges, creditRefunds, jobs, rechargeOrders, userPreferences, users } from "../../server/db/schema";
import type { JobRecord } from "../../server/types";

const testDataDir = mkdtempSync(join(tmpdir(), "yaozuo-ai-billing-api-test-"));
process.env.YAOZUO_DATA_DIR = testDataDir;

const appModule = await import("../../server/app");
const honoApp = appModule.app;
const realAccounts = appModule.accounts;
const realStore = appModule.store;
const { issueToken } = await import("../../server/accounts/auth");

let token = "";
let ownJobId = "";

async function createUser(phone: string, displayName: string) {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  realStore.db
    .insert(users)
    .values({
      id,
      phone,
      passwordHash: await Bun.password.hash("ApiTest12345!@#$"),
      displayName,
      avatarText: displayName.slice(0, 2),
      credits: 2480,
      status: "active",
      passwordVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  realStore.db.insert(userPreferences).values({ userId: id, updatedAt: timestamp }).run();
  return { id, phone, displayName, credits: 2480, isAdmin: false };
}

beforeAll(async () => {
  const user = await createUser("13800000041", "账单 API 用户");
  const other = await createUser("13800000042", "其他账单用户");
  token = (await issueToken(realAccounts, user)).token;
  ownJobId = crypto.randomUUID();
  const otherJobId = crypto.randomUUID();
  const timestamp = "2026-07-26T08:00:00.000Z";
  const job = (id: string, ownerUserId: string, title: string): JobRecord => ({
    id,
    ownerUserId,
    moduleId: "ad-script",
    title,
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
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  realStore.db
    .insert(jobs)
    .values([job(ownJobId, user.id, "自有口播任务"), job(otherJobId, other.id, "他人任务")])
    .run();
  realStore.db
    .insert(rechargeOrders)
    .values([
      {
        id: crypto.randomUUID(),
        userId: user.id,
        idempotencyKey: "own-order",
        packageId: "starter",
        amountCny: 19,
        credits: 1000,
        balanceAfter: 3480,
        requestFingerprint: `${user.id}:starter`,
        status: "succeeded",
        createdAt: timestamp,
        completedAt: timestamp,
      },
      {
        id: crypto.randomUUID(),
        userId: other.id,
        idempotencyKey: "foreign-order",
        packageId: "starter",
        amountCny: 19,
        credits: 1000,
        balanceAfter: 3480,
        requestFingerprint: `${other.id}:starter`,
        status: "succeeded",
        createdAt: timestamp,
        completedAt: timestamp,
      },
    ])
    .run();
  realStore.db
    .insert(creditCharges)
    .values([
      {
        id: crypto.randomUUID(),
        userId: user.id,
        jobId: ownJobId,
        amount: 20,
        balanceAfter: 3460,
        createdAt: timestamp,
      },
      {
        id: crypto.randomUUID(),
        userId: other.id,
        jobId: otherJobId,
        amount: 30,
        balanceAfter: 3450,
        createdAt: timestamp,
      },
    ])
    .run();
  realStore.db
    .insert(creditRefunds)
    .values({
      id: crypto.randomUUID(),
      userId: user.id,
      jobId: ownJobId,
      amount: 20,
      balanceAfter: 3480,
      reason: "整批生成失败",
      createdAt: "2026-07-26T09:00:00.000Z",
    })
    .run();
});

afterAll(() => {
  realAccounts.close();
  realStore.close();
  rmSync(testDataDir, { recursive: true, force: true });
});

const headers = () => ({ Authorization: `Bearer ${token}` });

describe("AI billing API", () => {
  test("requires authentication", async () => {
    expect((await honoApp.request("/api/billing/ai/recharges")).status).toBe(401);
    expect((await honoApp.request("/api/billing/ai/consumption")).status).toBe(401);
  });

  test("returns only the current user's recharge records", async () => {
    const response = await honoApp.request("/api/billing/ai/recharges?page=1&pageSize=10", { headers: headers() });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      total: 1,
      page: 1,
      pageSize: 10,
      records: [{ source: "mock_recharge", credits: 1000, amountCny: 19 }],
    });
  });

  test("returns owned charges and refunds with task metadata", async () => {
    const response = await honoApp.request("/api/billing/ai/consumption?page=1&pageSize=10", {
      headers: headers(),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      total: number;
      records: Array<{ jobId: string; jobTitle?: string; type: string; creditChange: number }>;
    };
    expect(body.total).toBe(2);
    expect(body.records).toMatchObject([
      { jobId: ownJobId, jobTitle: "自有口播任务", type: "refund", creditChange: 20 },
      { jobId: ownJobId, jobTitle: "自有口播任务", type: "charge", creditChange: -20 },
    ]);
  });
});
