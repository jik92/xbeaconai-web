import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { userPreferences, users } from "../../server/db/schema";

const dataDir = process.env.YAOZUO_DATA_DIR;
if (!dataDir) throw new Error("YAOZUO_DATA_DIR is required");
mkdirSync(dataDir, { recursive: true });
await Bun.write(
  join(dataDir, "capabilities.json"),
  JSON.stringify({
    entries: [
      { id: "aihubmix-image", status: "verified" },
      { id: "ark-seedance-fast", status: "verified" },
    ],
  }),
);

const appModule = await import("../../server/app");
const { app, accounts, queue, store } = appModule;
const { issueToken } = await import("../../server/accounts/auth");
const { providerCredentials } = await import("../../server/byok/credential-store");

const originalEnqueue = queue.enqueue.bind(queue);
const enqueued: string[] = [];
let token = "";
let userId = "";
let imageAssetId = "";
let videoAssetId = "";

beforeAll(async () => {
  queue.enqueue = async (jobId: string) => {
    enqueued.push(jobId);
  };
  providerCredentials.set("OPENAI_KEY", "test-aihubmix-key");
  providerCredentials.saveChecks([
    {
      providerId: "aihubmix",
      provider: "AIHubMix",
      status: "available",
      message: "test verified",
      latencyMs: 1,
      checkedAt: new Date().toISOString(),
    },
  ]);
  userId = crypto.randomUUID();
  const now = new Date().toISOString();
  const user = {
    id: userId,
    phone: "13800000081",
    passwordHash: await Bun.password.hash("ApiTest12345!@#$"),
    displayName: "AI 创作测试用户",
    avatarText: "AI",
    credits: 2480,
    status: "active" as const,
    passwordVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
  store.db.insert(users).values(user).run();
  store.db.insert(userPreferences).values({ userId, updatedAt: now }).run();
  token = (await issueToken(accounts, { ...user, isAdmin: false })).token;
  imageAssetId = crypto.randomUUID();
  videoAssetId = crypto.randomUUID();
  accounts.createAsset({
    id: imageAssetId,
    ownerUserId: userId,
    storageKey: `users/${userId}/image.png`,
    originalName: "image.png",
    mimeType: "image/png",
    byteSize: 128,
    kind: "media",
    displayName: "参考图",
    createdAt: now,
  });
  accounts.createAsset({
    id: videoAssetId,
    ownerUserId: userId,
    storageKey: `users/${userId}/video.mp4`,
    originalName: "video.mp4",
    mimeType: "video/mp4",
    byteSize: 256,
    kind: "media",
    displayName: "参考视频",
    createdAt: now,
  });
});

afterAll(() => {
  queue.enqueue = originalEnqueue;
  providerCredentials.close();
  accounts.close();
  store.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const headers = (key = crypto.randomUUID()) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "Idempotency-Key": key,
});

const imageRequest = () => ({
  kind: "image",
  title: "商品主图",
  prompt: "保留商品，替换为白色摄影棚",
  modelId: "gpt-image-1-mini",
  ratio: "1:1",
  resolution: "1k",
  count: 1,
  referenceAssetIds: [imageAssetId],
  revisionMode: "new",
});

describe("dedicated AI creation API", () => {
  test("publishes real image and video capabilities from independent Provider Doctor checks", async () => {
    const response = await app.request("/api/creation/capabilities", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      models: Array<{
        id: string;
        kind: string;
        enabled: boolean;
        executionMode: string;
        minReferences: number;
        maxReferences: number;
      }>;
    };
    const imageModels = body.models.filter((model) => model.kind === "image");
    expect(imageModels.map((model) => model.id)).toEqual([
      "gpt-image-1-mini",
      "seedream-5-lite",
      "seedream-4-5",
      "seedream-4-0",
      "nano-banana-2",
      "nano-banana-pro",
      "gpt-image-2-stable",
    ]);
    expect(imageModels.every((model) => model.executionMode === "real" && model.enabled)).toBeTrue();
    expect(
      body.models
        .filter((model) => model.kind === "video")
        .every((model) => model.executionMode === "real" && !model.enabled),
    ).toBeTrue();

    providerCredentials.saveChecks([
      {
        providerId: "aihubmix",
        provider: "AIHubMix",
        status: "invalid",
        message: "test unavailable",
        latencyMs: 1,
        checkedAt: new Date().toISOString(),
      },
      {
        providerId: "ark",
        provider: "Ark",
        status: "available",
        message: "test verified",
        latencyMs: 1,
        checkedAt: new Date().toISOString(),
      },
    ]);
    const reversedResponse = await app.request("/api/creation/capabilities", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const reversed = (await reversedResponse.json()) as typeof body;
    expect(reversed.models.filter((model) => model.kind === "image").every((model) => !model.enabled)).toBeTrue();
    expect(reversed.models.filter((model) => model.kind === "video").every((model) => model.enabled)).toBeTrue();

    providerCredentials.saveChecks([
      {
        providerId: "aihubmix",
        provider: "AIHubMix",
        status: "available",
        message: "test verified",
        latencyMs: 1,
        checkedAt: new Date().toISOString(),
      },
    ]);
  });

  test("queues a normalized real-only image job and charges once for an idempotent request", async () => {
    const key = crypto.randomUUID();
    const first = await app.request("/api/ai-generate/jobs", {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify(imageRequest()),
    });
    const second = await app.request("/api/ai-generate/jobs", {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify(imageRequest()),
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    const created = (await first.json()) as { id: string; values: Record<string, string> };
    const repeated = (await second.json()) as { id: string };
    expect(repeated.id).toBe(created.id);
    expect(created.values).toMatchObject({
      kind: "image",
      referenceAssetIds: JSON.stringify([imageAssetId]),
      allowMockFallback: "false",
    });
    expect(enqueued.filter((id) => id === created.id)).toHaveLength(1);
    expect(accounts.getUser(userId)?.credits).toBe(2410);
  });

  test("rejects a reference MIME type unsupported by the selected image model", async () => {
    const response = await app.request("/api/ai-generate/jobs", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ ...imageRequest(), referenceAssetIds: [videoAssetId] }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "UNSUPPORTED_REFERENCE_TYPE" } });
  });

  test("rejects unsupported image reference counts before charging or queueing", async () => {
    const creditsBefore = accounts.getUser(userId)?.credits;
    const queuedBefore = enqueued.length;
    const missingGptReference = await app.request("/api/ai-generate/jobs", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        ...imageRequest(),
        modelId: "gpt-image-2-stable",
        referenceAssetIds: [],
      }),
    });

    expect(missingGptReference.status).toBe(422);
    expect(await missingGptReference.json()).toMatchObject({
      error: { code: "INVALID_AI_GENERATE_CONFIG", message: "该模型至少需要 1 张参考图" },
    });

    const unsupportedNanoReference = await app.request("/api/ai-generate/jobs", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        ...imageRequest(),
        modelId: "nano-banana-2",
        referenceAssetIds: [imageAssetId],
      }),
    });
    expect(unsupportedNanoReference.status).toBe(422);
    expect(await unsupportedNanoReference.json()).toMatchObject({
      error: { code: "INVALID_AI_GENERATE_CONFIG", message: "该模型最多支持 0 张参考图" },
    });
    expect(accounts.getUser(userId)?.credits).toBe(creditsBefore);
    expect(enqueued).toHaveLength(queuedBefore);
  });

  test("rejects unowned references, invalid parents, and unsupported model settings before charging", async () => {
    const unowned = await app.request("/api/ai-generate/jobs", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ ...imageRequest(), referenceAssetIds: [crypto.randomUUID()] }),
    });
    expect(unowned.status).toBe(422);
    expect(await unowned.json()).toMatchObject({ error: { code: "ASSET_NOT_AVAILABLE" } });

    const invalidParent = await app.request("/api/ai-generate/jobs", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ ...imageRequest(), parentJobId: crypto.randomUUID() }),
    });
    expect(invalidParent.status).toBe(422);
    expect(await invalidParent.json()).toMatchObject({ error: { code: "INVALID_PARENT_JOB" } });

    const invalidRatio = await app.request("/api/ai-generate/jobs", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ ...imageRequest(), ratio: "16:9" }),
    });
    expect(invalidRatio.status).toBe(422);
    expect(await invalidRatio.json()).toMatchObject({ error: { code: "INVALID_AI_GENERATE_CONFIG" } });
  });

  test("requires authentication and a currently verified image Provider", async () => {
    const unauthorized = await app.request("/api/ai-generate/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(imageRequest()),
    });
    expect(unauthorized.status).toBe(401);

    providerCredentials.saveChecks([
      {
        providerId: "aihubmix",
        provider: "AIHubMix",
        status: "invalid",
        message: "test unavailable",
        latencyMs: 1,
        checkedAt: new Date().toISOString(),
      },
    ]);
    const unavailable = await app.request("/api/ai-generate/jobs", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(imageRequest()),
    });
    expect(unavailable.status).toBe(403);
    expect(await unavailable.json()).toMatchObject({ error: { code: "PROVIDER_NOT_VERIFIED" } });
    providerCredentials.saveChecks([
      {
        providerId: "aihubmix",
        provider: "AIHubMix",
        status: "available",
        message: "test verified",
        latencyMs: 1,
        checkedAt: new Date().toISOString(),
      },
    ]);
  });

  test("prevents AI creation from using the generic string-map route", async () => {
    const response = await app.request("/api/ai-generate/jobs", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        title: "generic",
        values: { type: "图片" },
        allowMockFallback: true,
      }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "DEDICATED_WORKFLOW_REQUIRED" } });
  });

  test("rejects an insufficient balance without persisting or queueing a task", async () => {
    store.db.update(users).set({ credits: 0 }).where(eq(users.id, userId)).run();
    const queuedBefore = enqueued.length;
    const response = await app.request("/api/ai-generate/jobs", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(imageRequest()),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "INSUFFICIENT_CREDITS" } });
    expect(enqueued).toHaveLength(queuedBefore);
  });
});
