import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { userPreferences, users } from "../../server/db/schema";
import { createScriptRemixNextWorkspace, type ScriptRemixNextShot } from "../../shared/script-remix-next/workflow";

const dataDir = mkdtempSync(resolve(tmpdir(), "script-remix-next-api-"));
process.env.YAOZUO_DATA_DIR = dataDir;
process.env.BYOK_ENCRYPTION_KEY = "script-remix-next-test-key-32-characters";

const appModule = await import("../../server/app");
const honoApp = appModule.app;
const accounts = appModule.accounts;
const store = appModule.store;
const queue = appModule.queue;
const { issueToken } = await import("../../server/accounts/auth");

const originalEnqueue = queue.enqueue.bind(queue);
let token = "";
let userId = "";
let otherUserId = "";
let documentAssetId = "";
let productImageAssetId = "";
let generatedVideoAssetId = "";
let projectId = "";
const enqueued: string[] = [];

const shot: ScriptRemixNextShot = {
  id: crypto.randomUUID(),
  ordinal: 1,
  title: "分镜 01",
  speech: "这是第一条完整口播文案",
  visual: "主播在明亮室内展示商品正面细节",
  action: "双手拿起商品并转向镜头",
  camera: "中景缓慢推进",
  durationSeconds: 8,
  productRequirement: "保持商品颜色和版型一致",
  characterRequirement: "保持人物服装一致",
};

async function createUser(displayName: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const phone = `139${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  store.db
    .insert(users)
    .values({
      id,
      phone,
      passwordHash: await Bun.password.hash("ApiTest12345!@#$"),
      displayName,
      avatarText: displayName.slice(0, 2),
      credits: 2_000,
      status: "active",
      passwordVersion: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  store.db.insert(userPreferences).values({ userId: id, updatedAt: now }).run();
  return { id, phone, displayName, avatarText: displayName.slice(0, 2), credits: 2_000, isAdmin: false };
}

function auth(init: RequestInit = {}): RequestInit {
  return { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } };
}

beforeAll(async () => {
  queue.enqueue = async (jobId: string) => {
    enqueued.push(jobId);
  };
  const user = await createUser("新版脚本用户");
  userId = user.id;
  token = (await issueToken(accounts, user)).token;
  otherUserId = (await createUser("其他用户")).id;
  const now = new Date().toISOString();
  documentAssetId = crypto.randomUUID();
  productImageAssetId = crypto.randomUUID();
  generatedVideoAssetId = crypto.randomUUID();
  accounts.createAsset({
    id: documentAssetId,
    ownerUserId: userId,
    storageKey: `users/${userId}/script.md`,
    originalName: "script.md",
    mimeType: "text/markdown",
    byteSize: 512,
    kind: "media",
    displayName: "脚本文档",
    createdAt: now,
  });
  accounts.createAsset({
    id: productImageAssetId,
    ownerUserId: userId,
    storageKey: `users/${userId}/product.png`,
    originalName: "product.png",
    mimeType: "image/png",
    byteSize: 512,
    kind: "product",
    displayName: "商品图",
    createdAt: now,
  });
  accounts.createAsset({
    id: generatedVideoAssetId,
    ownerUserId: userId,
    storageKey: `users/${userId}/shot.mp4`,
    originalName: "shot.mp4",
    mimeType: "video/mp4",
    byteSize: 1_024,
    kind: "media",
    displayName: "分镜视频",
    createdAt: now,
  });
});

afterAll(() => {
  queue.enqueue = originalEnqueue;
  store.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("script remix next API", () => {
  test("requires authentication", async () => {
    const response = await honoApp.request("/api/jobs?moduleId=script-remix-next");
    expect(response.status).toBe(401);
  });

  test("rejects assets owned by another user", async () => {
    const foreignId = crypto.randomUUID();
    accounts.createAsset({
      id: foreignId,
      ownerUserId: otherUserId,
      storageKey: `users/${otherUserId}/foreign.txt`,
      originalName: "foreign.txt",
      mimeType: "text/plain",
      byteSize: 100,
      kind: "media",
      displayName: "其他脚本",
      createdAt: new Date().toISOString(),
    });
    const response = await honoApp.request(
      "/api/script-remix-next/projects",
      auth({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: "越权项目",
          documentAssetId: foreignId,
          productName: "测试商品",
          productImageAssetIds: [productImageAssetId],
        }),
      }),
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("INVALID_SCRIPT_DOCUMENT");
  });

  test("creates one isolated project idempotently", async () => {
    const body = {
      projectName: "新版项目",
      documentAssetId,
      productName: "测试商品",
      productDescription: "测试描述",
      productImageAssetIds: [productImageAssetId],
    };
    const first = await honoApp.request(
      "/api/script-remix-next/projects",
      auth({
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "next-create" },
        body: JSON.stringify(body),
      }),
    );
    const second = await honoApp.request(
      "/api/script-remix-next/projects",
      auth({
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "next-create" },
        body: JSON.stringify(body),
      }),
    );
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    const firstJob = await first.json();
    const secondJob = await second.json();
    projectId = firstJob.id;
    expect(secondJob.id).toBe(projectId);
    expect(firstJob.moduleId).toBe("script-remix-next");
    expect(firstJob.values.workflowPhase).toBe("analysis");
    expect(enqueued.filter((id) => id === projectId)).toHaveLength(1);
  });

  test("saves valid workspace and rejects foreign shot references", async () => {
    const workspace = { ...createScriptRemixNextWorkspace(), shots: [shot], composeOrder: [shot.id] };
    const saved = await honoApp.request(
      `/api/script-remix-next/projects/${projectId}`,
      auth({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace }) }),
    );
    expect(saved.status).toBe(200);
    const invalid = await honoApp.request(
      `/api/script-remix-next/projects/${projectId}`,
      auth({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace: { ...workspace, composeOrder: [crypto.randomUUID()] } }),
      }),
    );
    expect(invalid.status).toBe(422);
  });

  test("creates storyboard, reference image, and video jobs without calling video provider", async () => {
    const storyboard = await honoApp.request(
      "/api/script-remix-next/storyboards",
      auth({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, shots: [shot] }),
      }),
    );
    expect(storyboard.status).toBe(202);
    expect((await storyboard.json()).values.workflowPhase).toBe("storyboard");
    const reference = await honoApp.request(
      "/api/script-remix-next/reference-images",
      auth({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, shot }),
      }),
    );
    expect(reference.status).toBe(202);
    const video = await honoApp.request(
      "/api/script-remix-next/shots",
      auth({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          shot,
          settings: { modelId: "doubao-seedance-2-0-fast-260128", ratio: "9:16", resolution: "720p", duration: 8 },
          referenceAssetId: productImageAssetId,
        }),
      }),
    );
    expect(video.status).toBe(202);
    const videoJob = await video.json();
    expect(videoJob.values.workflowPhase).toBe("shot-generation");
    expect(videoJob.videoModel).toBe("doubao-seedance-2-0-fast-260128");
    store.update(videoJob.id, {
      status: "succeeded",
      progress: 100,
      result: {
        kind: "script-remix-next-shot-generation",
        title: videoJob.title,
        summary: "测试分镜视频已生成",
        artifacts: [
          {
            id: generatedVideoAssetId,
            name: "shot.mp4",
            mimeType: "video/mp4",
            url: `/api/assets/${generatedVideoAssetId}/access`,
            executionMode: "real",
            lineage: [],
          },
        ],
      },
    });
  });

  test("accepts composition only when every shot has an owned selected video", async () => {
    const workspace = {
      ...createScriptRemixNextWorkspace(),
      stage: 3,
      shots: [shot],
      referenceAssetIds: { [shot.id]: productImageAssetId },
      selectedVideoAssetIds: { [shot.id]: generatedVideoAssetId },
      composeOrder: [shot.id],
    };
    const response = await honoApp.request(
      "/api/script-remix-next/compose",
      auth({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, workspace }),
      }),
    );
    expect(response.status).toBe(202);
    const compose = await response.json();
    expect(compose.values.workflowPhase).toBe("compose");
    expect(JSON.parse(compose.values.orderedAssetIds)).toEqual([generatedVideoAssetId]);
  });

  test("lists new jobs separately from legacy remix jobs", async () => {
    const response = await honoApp.request("/api/jobs?moduleId=script-remix-next", auth());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jobs.length).toBeGreaterThanOrEqual(5);
    expect(body.jobs.every((job: { moduleId: string }) => job.moduleId === "script-remix-next")).toBe(true);
  });
});
