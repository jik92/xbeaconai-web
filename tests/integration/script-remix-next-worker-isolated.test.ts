import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { userPreferences, users } from "../../server/db/schema";
import type { JobRecord } from "../../server/types";
import type { ScriptRemixNextShot } from "../../shared/script-remix-next/workflow";
import { createScriptRemixNextJob } from "../../worker/jobs/job-script-remix-next";

const dataDir = mkdtempSync(resolve(tmpdir(), "script-remix-next-worker-"));
process.env.YAOZUO_DATA_DIR = dataDir;
process.env.BYOK_ENCRYPTION_KEY = "script-remix-next-worker-key-32-characters";

const appModule = await import("../../server/app");
const accounts = appModule.accounts;
const store = appModule.store;
let userId = "";
let documentId = "";
let productImageId = "";
let pngBytes = new Uint8Array();

const shots: ScriptRemixNextShot[] = [
  {
    id: crypto.randomUUID(),
    ordinal: 1,
    title: "分镜 01",
    speech: "这是第一条测试口播文案",
    visual: "人物在室内展示商品正面",
    action: "双手拿起商品",
    camera: "中景推进",
    durationSeconds: 8,
    productRequirement: "商品外观一致",
    characterRequirement: "人物服装一致",
  },
  {
    id: crypto.randomUUID(),
    ordinal: 2,
    title: "分镜 02",
    speech: "这是第二条测试口播文案",
    visual: "商品细节特写画面",
    action: "手指展示商品细节",
    camera: "近景横移",
    durationSeconds: 6,
    productRequirement: "商品外观一致",
    characterRequirement: "人物服装一致",
  },
];

function job(input: { phase: string; parentJobId?: string; values?: Record<string, string> }): JobRecord {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    ownerUserId: userId,
    moduleId: "script-remix-next",
    title: "新版脚本项目",
    status: "queued",
    progress: 0,
    stage: "排队中",
    overallExecutionMode: "real",
    values: { ...(input.values || {}), workflowPhase: input.phase },
    executionPlan: [],
    provenance: [],
    parentJobId: input.parentJobId,
    cancelRequested: false,
    providerCancelState: "none",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

beforeAll(async () => {
  userId = crypto.randomUUID();
  const now = new Date().toISOString();
  store.db
    .insert(users)
    .values({
      id: userId,
      phone: "13700000001",
      passwordHash: await Bun.password.hash("WorkerTest123!@#"),
      displayName: "Worker 测试",
      avatarText: "WT",
      credits: 2_000,
      status: "active",
      passwordVersion: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  store.db.insert(userPreferences).values({ userId, updatedAt: now }).run();
  documentId = crypto.randomUUID();
  productImageId = crypto.randomUUID();
  accounts.createAsset({
    id: documentId,
    ownerUserId: userId,
    storageKey: `users/${userId}/script.txt`,
    originalName: "script.txt",
    mimeType: "text/plain",
    byteSize: 100,
    kind: "media",
    displayName: "脚本",
    createdAt: now,
  });
  accounts.createAsset({
    id: productImageId,
    ownerUserId: userId,
    storageKey: `users/${userId}/product.png`,
    originalName: "product.png",
    mimeType: "image/png",
    byteSize: 100,
    kind: "product",
    displayName: "商品图",
    createdAt: now,
  });
  const imagePath = resolve(dataDir, "grid.png");
  const process = Bun.spawn(
    ["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=white:s=900x1200", "-frames:v", "1", imagePath],
    { stdout: "ignore", stderr: "ignore" },
  );
  expect(await process.exited).toBe(0);
  pngBytes = new Uint8Array(await Bun.file(imagePath).arrayBuffer());
});

afterAll(() => {
  store.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("script remix next Worker", () => {
  test("reads the uploaded document and persists structured analysis", async () => {
    const record = job({
      phase: "analysis",
      values: {
        documentAssetId: documentId,
        productName: "测试商品",
        productDescription: "测试描述",
        referenceAssetIds: JSON.stringify([productImageId]),
      },
    });
    store.create(record);
    let receivedScript = "";
    const handler = createScriptRemixNextJob({
      download: async (asset, path) => {
        expect(asset.id).toBe(documentId);
        await Bun.write(path, "这是一份完整的测试脚本文档，包含足够字符用于分镜解析和生成。");
      },
      upload: async () => {},
      analyze: async (input) => {
        receivedScript = input.script;
        return { shots, model: "gpt-5.6-sol", usage: {} };
      },
    });
    await handler.execute(record, { store, accounts, change: (id, patch) => store.update(id, patch) });
    const completed = store.get(record.id);
    expect(receivedScript).toContain("完整的测试脚本文档");
    expect(completed).toMatchObject({ status: "succeeded", progress: 100 });
    expect(JSON.parse(completed?.values.shots || "[]")).toHaveLength(2);
    expect(completed?.provenance[0]).toMatchObject({ provider: "aihubmix", model: "gpt-5.6-sol" });
  });

  test("generates, uploads, and splits a storyboard without an external image call", async () => {
    const root = job({
      phase: "analysis",
      values: {
        productName: "测试商品",
        portraitName: "测试人物",
        shots: JSON.stringify(shots),
        referenceAssetIds: JSON.stringify([productImageId]),
      },
    });
    root.status = "succeeded";
    store.create(root);
    const storyboard = job({
      phase: "storyboard",
      parentJobId: root.id,
      values: { ...root.values, shots: JSON.stringify(shots) },
    });
    store.create(storyboard);
    const uploaded: string[] = [];
    const handler = createScriptRemixNextJob({
      download: async (_asset, path) => {
        await Bun.write(path, pngBytes);
      },
      upload: async ({ key }) => {
        uploaded.push(key);
      },
      generateImages: async ({ prompt, images }) => {
        expect(prompt).toContain("严格 3×3");
        expect(prompt.match(/空白占位格/g)).toHaveLength(7);
        expect(images).toHaveLength(1);
        return [{ b64Json: Buffer.from(pngBytes).toString("base64") }];
      },
    });
    await handler.execute(storyboard, { store, accounts, change: (id, patch) => store.update(id, patch) });
    const completed = store.get(storyboard.id);
    expect(completed).toMatchObject({ status: "succeeded", progress: 100 });
    expect(completed?.result?.artifacts).toHaveLength(3);
    expect(Object.keys(JSON.parse(completed?.values.cellAssetIds || "{}"))).toEqual(shots.map((item) => item.id));
    expect(uploaded).toHaveLength(3);
    expect(completed?.provenance[0]).toMatchObject({ provider: "aihubmix", model: "gpt-image-2" });
  });
});
