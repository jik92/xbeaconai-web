import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { MediaAsset } from "../../server/accounts/account-store";
import { AccountStore } from "../../server/accounts/account-store";
import { users } from "../../server/db/schema";
import { SqliteJobStore } from "../../server/jobs/sqlite-job-store";
import type { JobRecord } from "../../server/types";

const dataDir = process.env.YAOZUO_DATA_DIR;
if (!dataDir) throw new Error("YAOZUO_DATA_DIR is required");
mkdirSync(join(dataDir, "results"), { recursive: true });

const { createAiGenerateJob } = await import("../../worker/jobs/job-ai-generate");

const databasePath = join(dataDir, "worker.sqlite");
const store = new SqliteJobStore(databasePath);
const accounts = new AccountStore(databasePath);
const ownerUserId = "11111111-1111-4111-8111-111111111111";
const imageAssetId = "22222222-2222-4222-8222-222222222222";
const generatedCalls: unknown[] = [];
const editedCalls: unknown[] = [];
const seedreamCalls: unknown[] = [];
const stagedReferenceCalls: unknown[] = [];
const cleanedStagingKeys: string[] = [];
const geminiInteractionCalls: unknown[] = [];
const geminiContentCalls: unknown[] = [];
const seedanceCalls: unknown[] = [];

const imageClient = {
  async generateImages(input: unknown) {
    generatedCalls.push(input);
    return [{ b64Json: "iVBORw0KGgo=" }];
  },
  async editImages(input: unknown) {
    editedCalls.push(input);
    return [{ b64Json: "iVBORw0KGgo=" }];
  },
  async generateSeedreamImages(input: unknown) {
    seedreamCalls.push(input);
    return [{ b64Json: "iVBORw0KGgo=" }];
  },
  async generateGeminiInteractionImages(input: unknown) {
    geminiInteractionCalls.push(input);
    return [{ b64Json: "iVBORw0KGgo=", mimeType: "image/png" }];
  },
  async generateGeminiContentImages(input: unknown) {
    geminiContentCalls.push(input);
    return [{ b64Json: "iVBORw0KGgo=", mimeType: "image/png" }];
  },
};

const handler = createAiGenerateJob({
  imageClient,
  loadImageReference: async (asset: MediaAsset) => ({
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: asset.mimeType,
    name: asset.originalName,
    url: "https://signed.example/reference.png",
  }),
  stageImageReference: async (reference: { name: string }) => {
    stagedReferenceCalls.push(reference);
    return { url: "https://signed.example/staged-parent.png", key: "staging/parent.png" };
  },
  cleanupStagedReference: async (key: string) => {
    cleanedStagingKeys.push(key);
  },
  seedanceFactory: () => ({
    async execute(job: JobRecord, model: string) {
      seedanceCalls.push({ jobId: job.id, model });
      return {
        bytes: new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112]),
        mimeType: "video/mp4",
        executionMode: "real" as const,
        implementation: "ark-seedance-video" as const,
        durationSec: 5,
      };
    },
  }),
});

function job(id: string, values: Record<string, string>, videoModel?: JobRecord["videoModel"]): JobRecord {
  const now = new Date().toISOString();
  return {
    id,
    ownerUserId,
    moduleId: "ai-generate",
    title: values.title ?? "AI 创作",
    status: "queued",
    progress: 0,
    stage: "排队中",
    overallExecutionMode: "real",
    values,
    videoModel,
    executionPlan: [],
    provenance: [],
    cancelRequested: false,
    providerCancelState: "none",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt: now,
    updatedAt: now,
  };
}

function context() {
  return {
    store,
    accounts,
    change: (id: string, patch: Partial<JobRecord>) => store.update(id, patch),
  };
}

beforeAll(() => {
  const now = new Date().toISOString();
  store.db
    .insert(users)
    .values({
      id: ownerUserId,
      phone: "13800000082",
      passwordHash: "test",
      displayName: "Worker 测试",
      avatarText: "W",
      credits: 1000,
      status: "active",
      passwordVersion: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  accounts.createAsset({
    id: imageAssetId,
    ownerUserId,
    storageKey: `users/${ownerUserId}/reference.png`,
    originalName: "reference.png",
    mimeType: "image/png",
    byteSize: 3,
    kind: "media",
    displayName: "参考图",
    createdAt: now,
  });
});

afterAll(() => {
  accounts.close();
  store.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("dedicated AI creation Worker", () => {
  test("uses image edits when an owned reference image is present", async () => {
    const record = job(crypto.randomUUID(), {
      kind: "image",
      title: "商品主图",
      prompt: "替换背景",
      modelId: "gpt-image-1-mini",
      ratio: "1:1",
      resolution: "1k",
      count: "1",
      referenceAssetIds: JSON.stringify([imageAssetId]),
      revisionMode: "edit",
      allowMockFallback: "false",
    });
    store.create(record);

    await handler.execute(record, context());

    expect(editedCalls).toHaveLength(1);
    expect(generatedCalls).toHaveLength(0);
    expect(store.get(record.id)).toMatchObject({
      status: "succeeded",
      overallExecutionMode: "real",
      result: { artifacts: [{ mimeType: "image/png", executionMode: "real" }] },
    });
    const artifactId = store.get(record.id)?.result?.artifacts[0]?.id;
    expect(artifactId && accounts.getArtifact(ownerUserId, artifactId)).toMatchObject({ mime_type: "image/png" });
    expect(artifactId && accounts.getArtifact(crypto.randomUUID(), artifactId)).toBeNull();
  });

  test("uses image generations when no reference image is present", async () => {
    const record = job(crypto.randomUUID(), {
      kind: "image",
      title: "概念图",
      prompt: "未来城市",
      modelId: "gpt-image-1-mini",
      ratio: "3:2",
      resolution: "1k",
      count: "1",
      referenceAssetIds: "[]",
      revisionMode: "new",
      allowMockFallback: "false",
    });
    store.create(record);

    await handler.execute(record, context());

    expect(generatedCalls).toHaveLength(1);
    expect(store.get(record.id)?.status).toBe("succeeded");
  });

  test("routes Seedream to Predictions with the official model ID and signed references", async () => {
    const record = job(crypto.randomUUID(), {
      kind: "image",
      title: "融合图",
      prompt: "融合参考图",
      modelId: "seedream-4-5",
      ratio: "1:1",
      resolution: "2k",
      count: "1",
      referenceAssetIds: JSON.stringify([imageAssetId]),
      revisionMode: "edit",
      allowMockFallback: "false",
    });
    store.create(record);

    await handler.execute(record, context());

    expect(seedreamCalls.at(-1)).toMatchObject({
      model: "doubao-seedream-4-5",
      imageUrls: ["https://signed.example/reference.png"],
      size: "2K",
    });
    expect(store.get(record.id)).toMatchObject({
      status: "succeeded",
      provenance: [{ implementation: "aihubmix-predictions", model: "doubao-seedream-4-5" }],
    });
  });

  test("routes Nano Banana 2 to Gemini Interactions with the official model ID", async () => {
    const record = job(crypto.randomUUID(), {
      kind: "image",
      title: "快速创作",
      prompt: "透明香蕉台灯",
      modelId: "nano-banana-2",
      ratio: "1:1",
      resolution: "1k",
      count: "1",
      referenceAssetIds: "[]",
      revisionMode: "new",
      allowMockFallback: "false",
    });
    store.create(record);

    await handler.execute(record, context());

    expect(geminiInteractionCalls.at(-1)).toMatchObject({
      model: "gemini-3.1-flash-image",
      aspectRatio: "1:1",
      imageSize: "1K",
      images: [],
    });
    expect(store.get(record.id)).toMatchObject({
      status: "succeeded",
      provenance: [{ implementation: "gemini-interactions", model: "gemini-3.1-flash-image" }],
    });
  });

  test("routes Nano Banana Pro to Gemini content with inline references", async () => {
    const record = job(crypto.randomUUID(), {
      kind: "image",
      title: "专业创作",
      prompt: "商品摄影棚",
      modelId: "nano-banana-pro",
      ratio: "16:9",
      resolution: "2k",
      count: "1",
      referenceAssetIds: JSON.stringify([imageAssetId]),
      revisionMode: "edit",
      allowMockFallback: "false",
    });
    store.create(record);

    await handler.execute(record, context());

    expect(geminiContentCalls.at(-1)).toMatchObject({
      model: "gemini-3-pro-image-preview",
      aspectRatio: "16:9",
      imageSize: "2K",
      images: [{ mimeType: "image/png", name: "reference.png" }],
    });
    expect(store.get(record.id)).toMatchObject({
      status: "succeeded",
      provenance: [{ implementation: "gemini-content", model: "gemini-3-pro-image-preview" }],
    });
  });

  test("routes GPT Image 2 edits with the official model ID", async () => {
    const record = job(crypto.randomUUID(), {
      kind: "image",
      title: "稳定编辑",
      prompt: "替换背景",
      modelId: "gpt-image-2-stable",
      ratio: "1:1",
      resolution: "1k",
      count: "1",
      referenceAssetIds: JSON.stringify([imageAssetId]),
      revisionMode: "edit",
      allowMockFallback: "false",
    });
    store.create(record);

    await handler.execute(record, context());

    expect(editedCalls.at(-1)).toMatchObject({ model: "gpt-image-2" });
    expect(store.get(record.id)).toMatchObject({
      status: "succeeded",
      provenance: [{ implementation: "openai-images", model: "gpt-image-2" }],
    });
  });

  test("uses the parent generated image for a follow-up edit without repeated attachments", async () => {
    const parentName = `${crypto.randomUUID()}-parent.png`;
    await Bun.write(join(dataDir, "results", parentName), new Uint8Array([7, 8, 9]));
    const parent = {
      ...job(crypto.randomUUID(), {
        kind: "image",
        title: "上一轮图片",
        prompt: "白色摄影棚",
        modelId: "gpt-image-1-mini",
        ratio: "1:1",
        resolution: "1k",
        count: "1",
        referenceAssetIds: "[]",
        revisionMode: "new",
        allowMockFallback: "false",
      }),
      status: "succeeded" as const,
      progress: 100,
      result: {
        kind: "ai-generate",
        title: "上一轮图片",
        summary: "完成",
        artifacts: [
          {
            id: crypto.randomUUID(),
            name: parentName,
            mimeType: "image/png",
            url: "/api/artifacts/parent",
            executionMode: "real" as const,
            lineage: [],
          },
        ],
      },
    };
    store.create(parent);
    const child = {
      ...job(crypto.randomUUID(), {
        kind: "image",
        title: "继续修改",
        prompt: "改成夜景",
        modelId: "gpt-image-1-mini",
        ratio: "1:1",
        resolution: "1k",
        count: "1",
        referenceAssetIds: "[]",
        revisionMode: "edit",
        allowMockFallback: "false",
        parentJobId: parent.id,
      }),
      parentJobId: parent.id,
    };
    store.create(child);
    const editCount = editedCalls.length;
    const generationCount = generatedCalls.length;

    await handler.execute(child, context());

    expect(editedCalls).toHaveLength(editCount + 1);
    expect(generatedCalls).toHaveLength(generationCount);
    expect(store.get(child.id)?.status).toBe("succeeded");
  });

  test("stages a parent result before a Seedream follow-up edit", async () => {
    const parentName = `${crypto.randomUUID()}-seedream-parent.png`;
    await Bun.write(join(dataDir, "results", parentName), new Uint8Array([7, 8, 9]));
    const parent = {
      ...job(crypto.randomUUID(), {
        kind: "image",
        title: "上一轮 Seedream",
        prompt: "白色摄影棚",
        modelId: "seedream-4-5",
        ratio: "1:1",
        resolution: "2k",
        count: "1",
        referenceAssetIds: "[]",
        revisionMode: "new",
        allowMockFallback: "false",
      }),
      status: "succeeded" as const,
      progress: 100,
      result: {
        kind: "ai-generate",
        title: "上一轮 Seedream",
        summary: "完成",
        artifacts: [
          {
            id: crypto.randomUUID(),
            name: parentName,
            mimeType: "image/png",
            url: "/api/artifacts/parent",
            executionMode: "real" as const,
            lineage: [],
          },
        ],
      },
    };
    store.create(parent);
    const child = {
      ...job(crypto.randomUUID(), {
        kind: "image",
        title: "继续修改",
        prompt: "改成夜景",
        modelId: "seedream-4-5",
        ratio: "1:1",
        resolution: "2k",
        count: "1",
        referenceAssetIds: "[]",
        revisionMode: "edit",
        allowMockFallback: "false",
        parentJobId: parent.id,
      }),
      parentJobId: parent.id,
    };
    store.create(child);

    await handler.execute(child, context());

    expect(stagedReferenceCalls.at(-1)).toMatchObject({ name: parentName });
    expect(seedreamCalls.at(-1)).toMatchObject({
      imageUrls: ["https://signed.example/staged-parent.png"],
    });
    expect(cleanedStagingKeys).toContain("staging/parent.png");
    expect(store.get(child.id)?.status).toBe("succeeded");
  });

  test("delegates video generation to Seedance and never creates a Mock artifact", async () => {
    const model = "doubao-seedance-2-0-fast-260128";
    const record = job(
      crypto.randomUUID(),
      {
        kind: "video",
        title: "商品短片",
        prompt: "镜头环绕商品",
        modelId: model,
        ratio: "16:9",
        resolution: "720p",
        duration: "5",
        referenceMode: "omni",
        referenceAssetIds: "[]",
        revisionMode: "new",
        allowMockFallback: "false",
      },
      model,
    );
    store.create(record);

    await handler.execute(record, context());

    expect(seedanceCalls).toContainEqual({ jobId: record.id, model });
    expect(store.get(record.id)).toMatchObject({
      status: "succeeded",
      overallExecutionMode: "real",
      result: { artifacts: [{ mimeType: "video/mp4", executionMode: "real" }] },
    });
  });

  test("honors a persisted cancellation before invoking a paid image request", async () => {
    const record = {
      ...job(crypto.randomUUID(), {
        kind: "image",
        title: "已取消图片",
        prompt: "不应提交",
        modelId: "gpt-image-1-mini",
        ratio: "1:1",
        resolution: "1k",
        count: "1",
        referenceAssetIds: "[]",
        revisionMode: "new",
        allowMockFallback: "false",
      }),
      cancelRequested: true,
    };
    store.create(record);
    const generationCount = generatedCalls.length;

    await handler.execute(record, context());

    expect(generatedCalls).toHaveLength(generationCount);
    expect(store.get(record.id)).toMatchObject({ status: "cancelled", stage: "已取消" });
  });

  test("persists a Provider failure without creating a Mock fallback artifact", async () => {
    const failingHandler = createAiGenerateJob({
      imageClient: {
        async generateImages() {
          throw new Error("AIHUBMIX_503 https://private.example.test/result?X-Signature=secret sk-test-secret-value");
        },
        async editImages() {
          throw new Error("AIHUBMIX_503");
        },
        async generateSeedreamImages() {
          throw new Error("AIHUBMIX_503");
        },
        async generateGeminiInteractionImages() {
          throw new Error("AIHUBMIX_503");
        },
        async generateGeminiContentImages() {
          throw new Error("AIHUBMIX_503");
        },
      },
    });
    const record = job(crypto.randomUUID(), {
      kind: "image",
      title: "失败图片",
      prompt: "上游失败",
      modelId: "gpt-image-1-mini",
      ratio: "1:1",
      resolution: "1k",
      count: "1",
      referenceAssetIds: "[]",
      revisionMode: "new",
      allowMockFallback: "false",
    });
    store.create(record);

    await failingHandler.execute(record, context());

    expect(store.get(record.id)).toMatchObject({
      status: "failed",
      overallExecutionMode: "real",
      error: { code: "PROVIDER_ERROR", retryable: true },
    });
    expect(store.get(record.id)?.error?.message).not.toContain("private.example.test");
    expect(store.get(record.id)?.error?.message).not.toContain("sk-test-secret-value");
    expect(store.get(record.id)?.result).toBeUndefined();
  });
});
