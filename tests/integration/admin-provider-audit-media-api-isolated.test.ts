import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { userPreferences, users } from "../../server/db/schema";

const testDataDir = mkdtempSync(join(tmpdir(), "yaozuo-admin-audit-media-test-"));
process.env.YAOZUO_DATA_DIR = testDataDir;
process.env.BYOK_ENCRYPTION_KEY = "admin-audit-media-test-key-32-chars";
process.env.PUBLIC_MEDIA_BASE_URL = "https://files.xbeaconai.com";
process.env.ADMIN_PHONE = "13800000883";

const appModule = await import("../../server/app");
const honoApp = appModule.app;
const realAccounts = appModule.accounts;
const realAudits = appModule.providerAudits;
const realStore = appModule.store;
const { issueToken } = await import("../../server/accounts/auth");
const { providerCredentials } = await import("../../server/byok/credential-store");

let token = "";
let auditId = "";

beforeAll(async () => {
  const userId = crypto.randomUUID();
  const assetId = crypto.randomUUID();
  const now = new Date().toISOString();
  const user = {
    id: userId,
    phone: "13800000883",
    displayName: "审计媒体管理员",
    avatarText: "审计",
    credits: 2480,
    isAdmin: true,
  };
  realStore.db
    .insert(users)
    .values({
      ...user,
      passwordHash: await Bun.password.hash("ApiTest12345!@#$"),
      status: "active",
      passwordVersion: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  realStore.db.insert(userPreferences).values({ userId, updatedAt: now }).run();
  token = (await issueToken(realAccounts, user)).token;
  realAccounts.createAsset({
    id: assetId,
    ownerUserId: userId,
    storageKey: `users/${userId}/generated/result image.png`,
    originalName: "result image.png",
    mimeType: "image/png",
    byteSize: 128,
    kind: "media",
    displayName: "审计生成图",
    createdAt: now,
  });
  const audit = realAudits.begin({
    jobId: crypto.randomUUID(),
    ownerUserId: userId,
    moduleId: "ai-generate",
    capability: "image-generate",
    provider: "aihubmix",
    operation: "generate-image",
    requestPayload: { prompt: "测试" },
  });
  auditId = audit.id;
  realAudits.complete({
    auditId,
    status: "succeeded",
    assetIds: [assetId],
    responsePayload: { status: "done" },
  });
});

afterAll(() => {
  delete process.env.PUBLIC_MEDIA_BASE_URL;
  delete process.env.ADMIN_PHONE;
  providerCredentials.close();
  realAudits.close();
  realAccounts.close();
  realStore.close();
  rmSync(testDataDir, { recursive: true, force: true });
});

describe("admin provider audit media API", () => {
  test("returns image variants on the exact media CDN without a binary preview endpoint", async () => {
    const response = await honoApp.request(`/api/admin/provider-audits/${auditId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      assets: Array<{
        thumbnailUrl: string;
        url: string;
        originalUrl: string;
      }>;
    };
    expect(body.assets[0]).toMatchObject({
      thumbnailUrl: expect.stringContaining("https://files.xbeaconai.com/users/"),
      url: expect.stringContaining("?x-tos-process=style/preview"),
      originalUrl: expect.stringMatching(/^https:\/\/files\.xbeaconai\.com\/users\/.+result%20image\.png$/),
    });
    expect(
      await honoApp.request(`/api/admin/provider-audits/${auditId}/assets/${crypto.randomUUID()}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ).toHaveProperty("status", 404);
  });
});
