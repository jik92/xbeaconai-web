import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobs, users } from "../../server/db/schema";
import type { JobRecord } from "../../server/types";

const testDataDir = mkdtempSync(join(tmpdir(), "yaozuo-admin-release-api-test-"));
process.env.YAOZUO_DATA_DIR = testDataDir;

const appModule = await import("../../server/app");
const honoApp = appModule.app;
const realAccounts = appModule.accounts;
const realStore = appModule.store;
const { env } = await import("../../server/env");
const { issueToken } = await import("../../server/accounts/auth");

let adminToken = "";
let adminId = "";
let memberToken = "";
let memberId = "";

async function createUser(phone: string, displayName: string) {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  realAccounts.db
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
  return { id, phone, displayName, credits: 2480, isAdmin: env.adminPhones.has(phone) };
}

beforeAll(async () => {
  const adminPhone = env.adminPhones.values().next().value;
  if (!adminPhone) throw new Error("ADMIN_PHONE must contain at least one phone number");
  const admin = await createUser(adminPhone, "管理员");
  const member = await createUser("13800000405", "接口测试用户");
  adminId = admin.id;
  memberId = member.id;
  adminToken = (await issueToken(realAccounts, admin)).token;
  memberToken = (await issueToken(realAccounts, member)).token;
});

afterAll(() => {
  realAccounts.close();
  realStore.close();
  rmSync(testDataDir, { recursive: true, force: true });
});

const request = (token: string, userIds: string[]) =>
  honoApp.request("/api/admin/users/release", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ userIds }),
  });

describe("admin account release API", () => {
  test("enforces authentication and administrator access", async () => {
    const unauthenticated = await honoApp.request("/api/admin/users/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds: [memberId] }),
    });
    expect(unauthenticated.status).toBe(401);
    expect((await request(memberToken, [memberId])).status).toBe(403);
  });

  test("returns a real per-account validation result without touching external storage", async () => {
    const activeResponse = await request(adminToken, [memberId, memberId]);
    expect(activeResponse.status).toBe(200);
    expect(await activeResponse.json()).toMatchObject({
      results: [{ userId: memberId, released: false, error: { code: "USER_NOT_DISABLED", retryable: false } }],
    });

    realAccounts.setAdminUserStatus({
      userId: memberId,
      adminUserId: adminId,
      status: "disabled",
    });
    const now = new Date().toISOString();
    const queuedJob: JobRecord = {
      id: crypto.randomUUID(),
      ownerUserId: memberId,
      moduleId: "video-create",
      title: "运行中任务",
      status: "queued",
      progress: 0,
      stage: "排队中",
      overallExecutionMode: "real",
      values: {},
      executionPlan: [],
      provenance: [],
      cancelRequested: false,
      providerCancelState: "none",
      stagingKeys: [],
      jobSchemaVersion: 2,
      createdAt: now,
      updatedAt: now,
    };
    realAccounts.db.insert(jobs).values(queuedJob).run();

    const queuedResponse = await request(adminToken, [memberId]);
    expect(queuedResponse.status).toBe(200);
    expect(await queuedResponse.json()).toMatchObject({
      results: [{ userId: memberId, released: false, error: { code: "USER_HAS_ACTIVE_JOBS", retryable: true } }],
    });
    expect(realAccounts.getUserSecurity(memberId)?.status).toBe("disabled");
  });
});
