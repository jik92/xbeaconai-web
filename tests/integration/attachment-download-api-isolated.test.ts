import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { userPreferences, users } from "../../server/db/schema";
import type { JobRecord } from "../../server/types";

const testDataDir = mkdtempSync(join(tmpdir(), "yaozuo-attachment-download-test-"));
const adminPhone = "13800000991";
process.env.YAOZUO_DATA_DIR = testDataDir;
process.env.BYOK_ENCRYPTION_KEY = "attachment-download-test-key-32-characters";
process.env.JWT_SECRET = "attachment-download-jwt-secret-32-characters";
process.env.ADMIN_PHONE = adminPhone;

const appModule = await import("../../server/app");
const honoApp = appModule.app;
const realAccounts = appModule.accounts;
const realStore = appModule.store;
const { issueToken } = await import("../../server/accounts/auth");
const { providerCredentials } = await import("../../server/byok/credential-store");

let userToken = "";
let otherToken = "";
let adminToken = "";
let userId = "";
let jobId = "";
let artifactId = "";

function job(input: { id: string; ownerUserId: string; text: string }): JobRecord {
  const now = new Date().toISOString();
  return {
    id: input.id,
    ownerUserId: input.ownerUserId,
    moduleId: "ai-generate",
    title: "测试文本任务",
    status: "succeeded",
    progress: 100,
    stage: "已完成",
    overallExecutionMode: "real",
    values: {},
    executionPlan: [],
    provenance: [],
    result: {
      kind: "text",
      title: "测试文本任务",
      summary: input.text,
      artifacts: [
        {
          id: crypto.randomUUID(),
          name: "结果.txt",
          mimeType: "text/plain",
          text: input.text,
          executionMode: "real",
          lineage: [],
        },
      ],
    },
    cancelRequested: false,
    providerCancelState: "none",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt: now,
    updatedAt: now,
  };
}

async function createUser(phone: string, displayName: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
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
      createdAt: now,
      updatedAt: now,
    })
    .run();
  realStore.db.insert(userPreferences).values({ userId: id, updatedAt: now }).run();
  const user = realAccounts.getUser(id);
  if (!user) throw new Error("test user missing");
  return { id, token: (await issueToken(realAccounts, user)).token };
}

async function issue(resource: Record<string, unknown>, token = userToken) {
  return honoApp.request("/api/downloads/tickets", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(resource),
  });
}

beforeAll(async () => {
  const user = await createUser("13800000992", "下载用户");
  const other = await createUser("13800000993", "其他用户");
  const admin = await createUser(adminPhone, "下载管理员");
  userId = user.id;
  userToken = user.token;
  otherToken = other.token;
  adminToken = admin.token;

  jobId = crypto.randomUUID();
  realStore.create(job({ id: jobId, ownerUserId: userId, text: "只属于当前用户的导出内容" }));

  artifactId = crypto.randomUUID();
  const storageKey = "attachment-test/result.txt";
  mkdirSync(join(testDataDir, "results", "attachment-test"), { recursive: true });
  writeFileSync(join(testDataDir, "results", storageKey), "持久化附件内容", "utf8");
  realAccounts.createArtifact({
    id: artifactId,
    ownerUserId: userId,
    jobId,
    storageKey,
    name: "持久化结果.txt",
    mimeType: "text/plain",
    createdAt: new Date().toISOString(),
  });
  providerCredentials.set("TOS_ACCESS_KEY_ID", "test-admin-export-value", admin.id);
});

afterAll(() => {
  providerCredentials.close();
  realAccounts.close();
  realStore.close();
  rmSync(testDataDir, { recursive: true, force: true });
});

describe("attachment download API", () => {
  test("issues an owned job-text ticket and redeems it without a Bearer header", async () => {
    const response = await issue({ kind: "job-text", jobId });
    expect(response.status).toBe(201);
    const ticket = (await response.json()) as { url: string; expiresAt: string };
    expect(ticket.expiresAt).toBeString();

    const download = await honoApp.request(ticket.url);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("只属于当前用户的导出内容");
    expect(download.headers.get("content-disposition")).toContain("attachment;");
    expect(download.headers.get("cache-control")).toBe("private, no-store");
    expect(download.headers.get("referrer-policy")).toBe("no-referrer");
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("downloads an owned persisted non-media artifact", async () => {
    const response = await issue({ kind: "artifact", artifactId });
    expect(response.status).toBe(201);
    const ticket = (await response.json()) as { url: string };
    const download = await honoApp.request(ticket.url);

    expect(download.status).toBe(200);
    expect(await download.text()).toBe("持久化附件内容");
    expect(download.headers.get("content-disposition")).toContain("attachment;");
  });

  test("does not issue a ticket for another user's resource", async () => {
    expect((await issue({ kind: "artifact", artifactId }, otherToken)).status).toBe(404);
  });

  test("keeps the admin environment export administrator-only", async () => {
    expect((await issue({ kind: "admin-env" })).status).toBe(403);

    const response = await issue({ kind: "admin-env" }, adminToken);
    expect(response.status).toBe(201);
    const ticket = (await response.json()) as { url: string };
    const download = await honoApp.request(ticket.url);

    expect(download.status).toBe(200);
    expect(await download.text()).toContain("TOS_ACCESS_KEY_ID=test-admin-export-value");
    expect(download.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''%2E%65%6E%76%2E%6B%65%79");
  });

  test("hides invalid ticket details", async () => {
    const response = await honoApp.request("/api/downloads/not-a-valid-ticket");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });
});
