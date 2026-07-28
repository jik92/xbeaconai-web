import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { userPreferences, users } from "../../server/db/schema";
import type { LibraryAsset } from "../../web/entities/types";

const testDataDir = mkdtempSync(join(tmpdir(), "yaozuo-public-media-api-test-"));
process.env.YAOZUO_DATA_DIR = testDataDir;
process.env.BYOK_ENCRYPTION_KEY = "public-media-api-test-key-32-characters";
process.env.PUBLIC_MEDIA_BASE_URL = "https://files.xbeaconai.com";

const appModule = await import("../../server/app");
const honoApp = appModule.app;
const realAccounts = appModule.accounts;
const realStore = appModule.store;
const { issueToken } = await import("../../server/accounts/auth");
const { providerCredentials } = await import("../../server/byok/credential-store");

let token = "";
let userId = "";

function headers() {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  userId = crypto.randomUUID();
  const now = new Date().toISOString();
  const user = {
    id: userId,
    phone: "13800000881",
    displayName: "公共媒体测试用户",
    avatarText: "公共",
    credits: 2480,
    isAdmin: false,
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

  for (const [originalName, mimeType] of [
    ["商品 主图.jpg", "image/jpeg"],
    ["source.mp4", "video/mp4"],
    ["voice.mp3", "audio/mpeg"],
  ] as const) {
    realAccounts.createAsset({
      id: crypto.randomUUID(),
      ownerUserId: userId,
      storageKey: `users/${userId}/${originalName}`,
      originalName,
      mimeType,
      byteSize: 128,
      kind: mimeType.startsWith("audio/") ? "voice" : "media",
      displayName: originalName,
      createdAt: now,
    });
  }

  realAccounts.createProductAssets(
    {
      id: crypto.randomUUID(),
      ownerUserId: userId,
      name: "测试商品",
      sharingScope: "private",
      createdAt: now,
    },
    [
      {
        id: crypto.randomUUID(),
        ownerUserId: userId,
        storageKey: `users/${userId}/products/商品 主图.jpg`,
        originalName: "商品 主图.jpg",
        mimeType: "image/jpeg",
        byteSize: 128,
        kind: "product",
        displayName: "商品主图",
        createdAt: now,
      },
    ],
  );
});

afterAll(() => {
  delete process.env.PUBLIC_MEDIA_BASE_URL;
  providerCredentials.close();
  realAccounts.close();
  realStore.close();
  rmSync(testDataDir, { recursive: true, force: true });
});

describe("asset public media API", () => {
  test("permits the configured CDN in CSP and sends a usable cross-origin Referer", async () => {
    const response = await honoApp.request("/api/assets", { headers: headers() });

    expect(response.headers.get("content-security-policy")).toContain("media-src 'self' https://files.xbeaconai.com");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  test("returns image previews while preserving original image URLs", async () => {
    const response = await honoApp.request("/api/assets", { headers: headers() });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { assets: LibraryAsset[] };
    const image = body.assets.find((asset) => asset.mimeType === "image/jpeg");

    expect(image?.url).toBe(
      `https://files.xbeaconai.com/users/${userId}/%E5%95%86%E5%93%81%20%E4%B8%BB%E5%9B%BE.jpg?x-tos-process=style/preview`,
    );
    expect(image?.originalUrl).toBe(
      `https://files.xbeaconai.com/users/${userId}/%E5%95%86%E5%93%81%20%E4%B8%BB%E5%9B%BE.jpg`,
    );
  });

  test("returns original media URLs for video and audio", async () => {
    const response = await honoApp.request("/api/assets", { headers: headers() });
    const body = (await response.json()) as { assets: LibraryAsset[] };

    for (const mimeType of ["video/mp4", "audio/mpeg"]) {
      const asset = body.assets.find((item) => item.mimeType === mimeType);
      expect(asset?.url).toBe(asset?.originalUrl);
      expect(asset?.url).toStartWith(`https://files.xbeaconai.com/users/${userId}/`);
    }
  });

  test("applies the same preview and original contract to product images", async () => {
    const response = await honoApp.request("/api/products", { headers: headers() });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { products: Array<{ images: LibraryAsset[] }> };
    const image = body.products[0]?.images[0];

    expect(image?.url).toEndWith("/products/%E5%95%86%E5%93%81%20%E4%B8%BB%E5%9B%BE.jpg?x-tos-process=style/preview");
    expect(image?.originalUrl).toEndWith("/products/%E5%95%86%E5%93%81%20%E4%B8%BB%E5%9B%BE.jpg");
  });
});
