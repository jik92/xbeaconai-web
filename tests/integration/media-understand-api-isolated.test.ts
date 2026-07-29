import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { users } from "../../server/db/schema";

const appModule = await import("../../server/app");
const honoApp = appModule.app;
const realAccounts = appModule.accounts;
const realStore = appModule.store;
const realQueue = appModule.queue;
const { issueToken } = await import("../../server/accounts/auth");
const { providerCredentials } = await import("../../server/byok/credential-store");

let token = "";
let ownerUserId = "";
let otherUserId = "";
let primaryAssetId = "";
let productImageId = "";
let otherAssetId = "";
let audioAssetId = "";

async function createUser(displayName: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const phone = `139${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  const user = {
    id,
    phone,
    passwordHash: await Bun.password.hash("MediaUnderstand123!"),
    displayName,
    avatarText: displayName.slice(0, 2),
    credits: 100,
    status: "active" as const,
    passwordVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
  realAccounts.db.insert(users).values(user).run();
  return { ...user, isAdmin: false };
}

beforeAll(async () => {
  realQueue.enqueue = async () => {};
  const checkedAt = new Date().toISOString();
  providerCredentials.saveChecks(
    [
      { providerId: "ark" as const, provider: "火山方舟" },
      { providerId: "tos" as const, provider: "火山 TOS" },
    ].map((item) => ({
      ...item,
      status: "available" as const,
      message: "test verified",
      latencyMs: 1,
      checkedAt,
    })),
  );
  const owner = await createUser("素材理解用户");
  const other = await createUser("其他用户");
  ownerUserId = owner.id;
  otherUserId = other.id;
  token = (await issueToken(realAccounts, owner)).token;
  primaryAssetId = crypto.randomUUID();
  productImageId = crypto.randomUUID();
  otherAssetId = crypto.randomUUID();
  audioAssetId = crypto.randomUUID();
  const now = new Date().toISOString();
  realAccounts.createAsset({
    id: primaryAssetId,
    ownerUserId,
    storageKey: `users/${ownerUserId}/source.mp4`,
    originalName: "source.mp4",
    mimeType: "video/mp4",
    byteSize: 1024,
    durationSec: 6,
    kind: "media",
    displayName: "原视频",
    createdAt: now,
  });
  realAccounts.createAsset({
    id: audioAssetId,
    ownerUserId,
    storageKey: `users/${ownerUserId}/voice.wav`,
    originalName: "voice.wav",
    mimeType: "audio/wav",
    byteSize: 1024,
    durationSec: 1,
    kind: "media",
    displayName: "原音频",
    createdAt: now,
  });
  realAccounts.createAsset({
    id: productImageId,
    ownerUserId,
    storageKey: `users/${ownerUserId}/cup.png`,
    originalName: "cup.png",
    mimeType: "image/png",
    byteSize: 512,
    kind: "media",
    displayName: "透明玻璃大茶缸",
    createdAt: now,
  });
  realAccounts.createAsset({
    id: otherAssetId,
    ownerUserId: otherUserId,
    storageKey: `users/${otherUserId}/private.mp4`,
    originalName: "private.mp4",
    mimeType: "video/mp4",
    byteSize: 1024,
    kind: "media",
    displayName: "他人视频",
    createdAt: now,
  });
});

afterAll(async () => {
  await realQueue.close();
  providerCredentials.close();
  realAccounts.close();
  realStore.close();
});

function body(idempotencyKey = crypto.randomUUID()) {
  return {
    modelId: "doubao-seed-2-0-lite-260428",
    reasoningEffort: "high",
    prompt: "把皮带改成透明玻璃大茶缸",
    primaryAssetId,
    referenceImageAssetIds: [productImageId],
    idempotencyKey,
  };
}

function request(input: ReturnType<typeof body>, authorization = token) {
  return honoApp.request("/api/media-understand/jobs", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authorization}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
}

describe("media understanding dedicated API", () => {
  test("requires authentication and publishes the four configured models", async () => {
    expect((await request(body(), "")).status).toBe(401);
    const response = await honoApp.request("/api/media-understand/capabilities", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).models).toHaveLength(4);
  });

  test("rejects a primary asset owned by another user", async () => {
    const response = await request({ ...body(), primaryAssetId: otherAssetId });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "MEDIA_UNDERSTAND_PRIMARY_NOT_FOUND", retryable: false },
    });
  });

  test("rejects Pro for pure audio according to the real Ark baseline", async () => {
    const response = await request({
      ...body(),
      modelId: "doubao-seed-2-1-pro-260628",
      primaryAssetId: audioAssetId,
      referenceImageAssetIds: [],
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "MEDIA_UNDERSTAND_MODEL_UNSUPPORTED", retryable: false },
    });
  });

  test("creates one real non-Mock job idempotently and charges once", async () => {
    const key = crypto.randomUUID();
    const first = await request(body(key));
    expect(first.status).toBe(202);
    const created = (await first.json()) as { id: string; values: Record<string, string> };
    expect(created.values.allowMockFallback).toBe("false");
    expect(JSON.parse(created.values.mediaUnderstandRequest)).toMatchObject({
      primaryAssetId,
      referenceImageAssetIds: [productImageId],
    });
    expect(JSON.parse(created.values.referenceMetadata)).toEqual([
      expect.objectContaining({
        id: primaryAssetId,
        name: "原视频",
        mimeType: "video/mp4",
        label: "主素材",
      }),
      expect.objectContaining({
        id: productImageId,
        name: "透明玻璃大茶缸",
        mimeType: "image/png",
        label: "商品参考图 1",
      }),
    ]);
    expect(realAccounts.getUser(ownerUserId)?.credits).toBe(95);

    const duplicate = await request(body(key));
    expect(duplicate.status).toBe(202);
    expect(((await duplicate.json()) as { id: string }).id).toBe(created.id);
    expect(realAccounts.getUser(ownerUserId)?.credits).toBe(95);
    expect(realStore.get(created.id)?.overallExecutionMode).toBe("real");
  });
});
