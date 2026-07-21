import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Isolated test database ──────────────────────────────────────────
// The app module creates singletons at import time using env.databasePath.
// To guarantee a migrated schema independent of the developer's local DB,
// we point YA_YAOZUO_DATA_DIR at a temp directory before importing the app.
const testDataDir = mkdtempSync(join(tmpdir(), "yaozuo-api-test-"));
process.env.YAOZUO_DATA_DIR = testDataDir;

// Now import the app — singletons will use the temp database
const appModule = await import("../../server/app");
const honoApp = appModule.app;
const realAccounts = appModule.accounts;
const realStore = appModule.store;
const realQueue = appModule.queue;
const { issueToken } = await import("../../server/accounts/auth");

const originalEnqueue = realQueue.enqueue.bind(realQueue);

beforeAll(() => {
  realQueue.enqueue = async (_jobId: string) => {};
});

afterAll(() => {
  realQueue.enqueue = originalEnqueue;
  realAccounts.close();
  realStore.close();
  try {
    rmSync(testDataDir, { recursive: true, force: true });
  } catch {
    /* ok */
  }
  try {
    rmSync(`${testDataDir}-wal`, { force: true });
  } catch {
    /* ok */
  }
  try {
    rmSync(`${testDataDir}-shm`, { force: true });
  } catch {
    /* ok */
  }
});

describe("douyin API integration (isolated DB)", () => {
  let token: string;
  let userId: string;
  let folderId: string;
  let otherUserId: string;
  let otherFolderId: string;

  beforeEach(async () => {
    const registration = await realAccounts.register({
      email: `api-test-${crypto.randomUUID().slice(0, 8)}@example.com`,
      password: "ApiTest12345!@#password",
      displayName: "API Tester",
    });
    userId = registration.user.id;
    const auth = await issueToken(realAccounts, registration.user);
    token = auth.token;

    realAccounts.ensureDefaultAssetFolder(userId);
    const defaultId = realAccounts.getDefaultAssetFolderId(userId);
    const folder = realAccounts.getAssetFolder(userId, defaultId);
    folderId = folder!.id;

    const otherReg = await realAccounts.register({
      email: `api-other-${crypto.randomUUID().slice(0, 8)}@example.com`,
      password: "OtherApiTest12345!",
      displayName: "Other User",
    });
    otherUserId = otherReg.user.id;
    realAccounts.ensureDefaultAssetFolder(otherUserId);
    const otherDefaultId = realAccounts.getDefaultAssetFolderId(otherUserId);
    const otherFolder = realAccounts.getAssetFolder(otherUserId, otherDefaultId);
    otherFolderId = otherFolder!.id;
  });

  function authHeaders() {
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }

  test("POST /api/imports/share-content/parse extracts douyin URL", async () => {
    const res = await honoApp.request("/api/imports/share-content/parse", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ text: "https://v.douyin.com/abc123/" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: Array<{ platformId: string }> };
    expect(body.candidates.length).toBeGreaterThanOrEqual(1);
    expect(body.candidates.some((c) => c.platformId === "douyin")).toBe(true);
  });

  test("POST /api/imports/share-content/parse extracts douyin share code", async () => {
    const res = await honoApp.request("/api/imports/share-content/parse", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ text: "4.66 i@C.uf :4pm kcN:/ 复制此链接，打开抖音搜索" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: Array<{ raw: string }> };
    const douyinCandidates = body.candidates.filter((c) => c.raw.includes("v.douyin.com"));
    expect(douyinCandidates.length).toBeGreaterThanOrEqual(1);
    expect(douyinCandidates.some((c) => c.raw.includes("4pmkcN"))).toBe(true);
  });

  test("POST /api/imports/share-content creates job for valid douyin candidate", async () => {
    const res = await honoApp.request("/api/imports/share-content", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        candidate: {
          raw: "https://v.douyin.com/abc123/",
          platformId: "douyin",
          confidence: "high",
          label: "抖音链接",
        },
        folderId,
      }),
    });
    expect(res.status).toBe(202);
    const job = (await res.json()) as { id: string; status: string; moduleId: string };
    expect(job.id).toBeTruthy();
    expect(job.status).toBe("queued");
    expect(job.moduleId).toBe("share-content-import");

    const stored = realStore.getOwned(job.id, userId);
    expect(stored).toBeDefined();
    expect(stored?.values.folderId).toBe(folderId);
  });

  test("POST /api/imports/share-content rejects foreign folder", async () => {
    const res = await honoApp.request("/api/imports/share-content", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        candidate: {
          raw: "https://v.douyin.com/abc123/",
          platformId: "douyin",
          confidence: "high",
          label: "抖音链接",
        },
        folderId: otherFolderId,
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code: string } };
    expect(body.error?.code).toBe("FOLDER_NOT_FOUND");
  });

  test("POST /api/imports/share-content is idempotent for same request", async () => {
    const payload = {
      candidate: {
        raw: "https://v.douyin.com/idempotent-test/",
        platformId: "douyin",
        confidence: "high",
        label: "抖音链接",
      },
      folderId,
    };
    const res1 = await honoApp.request("/api/imports/share-content", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    expect(res1.status).toBe(202);
    const job1 = (await res1.json()) as { id: string };

    const res2 = await honoApp.request("/api/imports/share-content", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    expect(res2.status).toBe(202);
    const job2 = (await res2.json()) as { id: string };
    expect(job2.id).toBe(job1.id);
  });

  test("POST /api/imports/share-content accepts recognition-only platform", async () => {
    const res = await honoApp.request("/api/imports/share-content", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        candidate: {
          raw: "https://www.youtube.com/watch?v=abc123",
          platformId: "youtube",
          confidence: "high",
          label: "YouTube 链接",
        },
        folderId,
      }),
    });
    expect(res.status).toBe(202);
    const job = (await res.json()) as { values: Record<string, string> };
    expect(job.values.downloadSupported).toBe("false");
  });

  test("GET /api/imports/share-content/{jobId} returns owned job", async () => {
    const createRes = await honoApp.request("/api/imports/share-content", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        candidate: {
          raw: "https://v.douyin.com/get-test/",
          platformId: "douyin",
          confidence: "high",
          label: "抖音链接",
        },
        folderId,
      }),
    });
    const job = (await createRes.json()) as { id: string };

    const getRes = await honoApp.request(`/api/imports/share-content/${job.id}`, {
      method: "GET",
      headers: authHeaders(),
    });
    expect(getRes.status).toBe(200);
    const fetched = (await getRes.json()) as { id: string };
    expect(fetched.id).toBe(job.id);
  });

  test("GET /api/imports/share-content/{jobId} returns 404 for another user's job", async () => {
    const otherUser = realAccounts.getUser(otherUserId)!;
    const otherAuth = await issueToken(realAccounts, otherUser);
    const otherHeaders = { Authorization: `Bearer ${otherAuth.token}`, "Content-Type": "application/json" };

    const createRes = await honoApp.request("/api/imports/share-content", {
      method: "POST",
      headers: otherHeaders,
      body: JSON.stringify({
        candidate: {
          raw: "https://v.douyin.com/other-user-job/",
          platformId: "douyin",
          confidence: "high",
          label: "抖音链接",
        },
        folderId: otherFolderId,
      }),
    });
    const otherJob = (await createRes.json()) as { id: string };

    const getRes = await honoApp.request(`/api/imports/share-content/${otherJob.id}`, {
      method: "GET",
      headers: authHeaders(),
    });
    expect(getRes.status).toBe(404);
  });

  test("POST /api/imports/share-content requires authentication", async () => {
    const res = await honoApp.request("/api/imports/share-content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidate: {
          raw: "https://v.douyin.com/noauth/",
          platformId: "douyin",
          confidence: "high",
          label: "test",
        },
        folderId,
      }),
    });
    expect(res.status).toBe(401);
  });
});
