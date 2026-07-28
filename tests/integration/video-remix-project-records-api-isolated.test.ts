import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { userPreferences, users } from "../../server/db/schema";
import type { JobRecord } from "../../server/types";

const testDataDir = mkdtempSync(join(tmpdir(), "yaozuo-remix-project-api-test-"));
process.env.YAOZUO_DATA_DIR = testDataDir;
process.env.BYOK_ENCRYPTION_KEY = "video-remix-project-test-key-32-characters";

const appModule = await import("../../server/app");
const honoApp = appModule.app;
const realAccounts = appModule.accounts;
const realStore = appModule.store;
const realQueue = appModule.queue;
const { issueToken } = await import("../../server/accounts/auth");
const { providerCredentials } = await import("../../server/byok/credential-store");

const originalEnqueue = realQueue.enqueue.bind(realQueue);
let token = "";
let userId = "";
let otherUserId = "";
let projectId = "";
let secondProjectId = "";
let sourceId = "";
let productAssetId = "";
let generatedAssetId = "";
let submissionSourceId = "";
let submissionProductAssetId = "";

function job(input: Partial<JobRecord> & Pick<JobRecord, "id" | "ownerUserId" | "values">): JobRecord {
  const timestamp = new Date().toISOString();
  return {
    id: input.id,
    ownerUserId: input.ownerUserId,
    moduleId: "video-remix",
    title: input.title ?? "帽子二创项目",
    status: input.status ?? "succeeded",
    progress: input.progress ?? 100,
    stage: input.stage ?? "全部提示词已生成",
    overallExecutionMode: input.overallExecutionMode ?? "real",
    values: input.values,
    executionPlan: input.executionPlan ?? [],
    provenance: input.provenance ?? [],
    result: input.result,
    error: input.error,
    parentJobId: input.parentJobId,
    cancelRequested: false,
    providerCancelState: "none",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt: input.createdAt ?? timestamp,
    updatedAt: input.updatedAt ?? timestamp,
  };
}

async function createUser(displayName: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const phone = `138${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
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
  return { id, phone, displayName, avatarText: displayName.slice(0, 2), credits: 2480, isAdmin: false };
}

function projectRequest(
  projectName: string,
  input: { sourceAssetId?: string; productImageAssetId?: string; voiceAssetId?: string } = {},
) {
  const requestSourceId = input.sourceAssetId ?? sourceId;
  const requestProductAssetId = input.productImageAssetId ?? productAssetId;
  return {
    projectName,
    mode: "product",
    product: {
      id: crypto.randomUUID(),
      productName: "巴拿马草帽",
      productImages: [
        {
          filename: "hat.jpg",
          objectKey: requestProductAssetId,
          fileUrl: `/api/assets/${requestProductAssetId}/content`,
          coverUrl: `/api/assets/${requestProductAssetId}/content`,
          fileType: "IMAGE",
          metaId: requestProductAssetId,
        },
      ],
      productFormMetaList: null,
      productFormDesc: "夏季草帽",
    },
    demand: "保留商品外观",
    rawMaterialFiles: [
      {
        filename: "source.mp4",
        objectKey: requestSourceId,
        fileUrl: `/api/assets/${requestSourceId}/content`,
        coverUrl: `/api/assets/${requestSourceId}/content`,
        fileType: "VIDEO",
      },
    ],
    voiceAsset: input.voiceAssetId
      ? {
          filename: "voice.mp3",
          objectKey: input.voiceAssetId,
          fileUrl: `/api/assets/${input.voiceAssetId}/content`,
          coverUrl: `/api/assets/${input.voiceAssetId}/content`,
          fileType: "AUDIO",
        }
      : null,
    portraitAssets: [],
  };
}

beforeAll(async () => {
  realQueue.enqueue = async (_jobId: string) => {};
  const checkedAt = new Date().toISOString();
  providerCredentials.saveChecks(
    [
      ["aihubmix", "AIHubMix"],
      ["ark", "火山方舟"],
      ["tos", "火山 TOS"],
    ].map(([providerId, provider]) => ({
      providerId: providerId as "aihubmix" | "ark" | "tos",
      provider,
      status: "available" as const,
      message: "test verified",
      latencyMs: 1,
      checkedAt,
    })),
  );
  const user = await createUser("项目测试用户");
  userId = user.id;
  token = (await issueToken(realAccounts, user)).token;
  otherUserId = (await createUser("其他用户")).id;
  projectId = crypto.randomUUID();
  secondProjectId = crypto.randomUUID();
  sourceId = crypto.randomUUID();
  productAssetId = crypto.randomUUID();
  generatedAssetId = crypto.randomUUID();
  submissionSourceId = crypto.randomUUID();
  submissionProductAssetId = crypto.randomUUID();
  const now = new Date().toISOString();
  realAccounts.createAsset({
    id: submissionSourceId,
    ownerUserId: userId,
    storageKey: `users/${userId}/remix-source.mp4`,
    originalName: "remix-source.mp4",
    mimeType: "video/mp4",
    byteSize: 256,
    kind: "media",
    displayName: "二创分镜",
    createdAt: now,
  });
  realAccounts.createProductAssets(
    {
      id: crypto.randomUUID(),
      ownerUserId: userId,
      name: "巴拿马草帽",
      description: "夏季草帽",
      sharingScope: "private",
      createdAt: now,
    },
    [
      {
        id: submissionProductAssetId,
        ownerUserId: userId,
        storageKey: `users/${userId}/hat.jpg`,
        originalName: "hat.jpg",
        mimeType: "image/jpeg",
        byteSize: 128,
        kind: "product",
        displayName: "巴拿马草帽",
        createdAt: now,
      },
    ],
  );
  const analysisEntries = JSON.stringify([
    { assetId: sourceId, name: "source.mp4", status: "succeeded", prompt: "完整的分镜提示词内容用于恢复" },
  ]);
  realStore.create(
    job({
      id: projectId,
      ownerUserId: userId,
      values: {
        workflowPhase: "analysis",
        sources: JSON.stringify([{ assetId: sourceId, name: "source.mp4" }]),
        productName: "巴拿马草帽",
        projectRequest: JSON.stringify(projectRequest("帽子二创项目")),
        analysisEntries,
        workspaceState: JSON.stringify({
          stage: 3,
          promptStates: {},
          selectedShotAssets: { [sourceId]: sourceId },
          composeOrder: [sourceId],
          composePreviewId: sourceId,
        }),
      },
    }),
  );
  realStore.create(
    job({
      id: crypto.randomUUID(),
      ownerUserId: userId,
      parentJobId: projectId,
      title: "镜头生成",
      values: { workflowPhase: "shot-generation", sourceAssetId: sourceId },
      result: {
        kind: "video-remix-shot-generation",
        title: "镜头生成",
        summary: "完成",
        artifacts: [
          {
            id: generatedAssetId,
            name: "generated.mp4",
            mimeType: "video/mp4",
            url: `/api/assets/${generatedAssetId}/content`,
            executionMode: "real",
            lineage: [],
          },
        ],
      },
    }),
  );
  realStore.create(
    job({
      id: secondProjectId,
      ownerUserId: userId,
      title: "另一个项目",
      values: {
        workflowPhase: "analysis",
        sources: JSON.stringify([{ assetId: sourceId, name: "source.mp4" }]),
        productName: "巴拿马草帽",
        projectRequest: JSON.stringify(projectRequest("另一个项目")),
        analysisEntries,
      },
    }),
  );
  realStore.create(
    job({
      id: crypto.randomUUID(),
      ownerUserId: otherUserId,
      title: "其他用户项目",
      values: {
        workflowPhase: "analysis",
        sources: JSON.stringify([{ assetId: sourceId, name: "source.mp4" }]),
        productName: "不可见商品",
        projectRequest: JSON.stringify(projectRequest("其他用户项目")),
        analysisEntries,
      },
    }),
  );
});

afterAll(() => {
  realQueue.enqueue = originalEnqueue;
  providerCredentials.close();
  realAccounts.close();
  realStore.close();
  rmSync(testDataDir, { recursive: true, force: true });
});

const headers = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

describe("video remix project records API", () => {
  test("lists only owned root projects with search, stage filtering, and pagination", async () => {
    const all = await honoApp.request("/api/video-remix/projects?page=1&pageSize=1", { headers: headers() });
    expect(all.status).toBe(200);
    const allBody = (await all.json()) as { projects: Array<{ id: string }>; total: number; pageSize: number };
    expect(allBody.total).toBe(2);
    expect(allBody.projects).toHaveLength(1);
    expect(allBody.pageSize).toBe(1);

    const searched = await honoApp.request("/api/video-remix/projects?query=%E5%B8%BD%E5%AD%90&stage=storyboard", {
      headers: headers(),
    });
    expect(searched.status).toBe(200);
    const searchedBody = (await searched.json()) as {
      projects: Array<{ id: string; generatedCount: number; sourceCount: number }>;
    };
    expect(searchedBody.projects).toEqual([
      expect.objectContaining({ id: projectId, generatedCount: 1, sourceCount: 1 }),
    ]);
  });

  test("restores root data, children, workspace, and reports missing assets", async () => {
    const response = await honoApp.request(`/api/video-remix/projects/${projectId}`, { headers: headers() });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      rootJob: { id: string };
      childJobs: Array<{ parentJobId?: string }>;
      workspace: { stage: number; promptStates: Record<string, { prompt: string }> };
      missingAssetIds: string[];
    };
    expect(body.rootJob.id).toBe(projectId);
    expect(body.childJobs).toHaveLength(1);
    expect(body.workspace.stage).toBe(3);
    expect(body.workspace.promptStates[sourceId]?.prompt).toContain("分镜提示词");
    expect(body.missingAssetIds).toContain(sourceId);
  });

  test("updates title and valid workspace but rejects a cross-shot generated selection", async () => {
    const workspace = {
      stage: 4,
      promptStates: {},
      selectedShotAssets: { [sourceId]: generatedAssetId },
      composeOrder: [sourceId],
      composePreviewId: sourceId,
    };
    const updated = await honoApp.request(`/api/video-remix/projects/${projectId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ title: "已重命名项目", workspace }),
    });
    expect(updated.status).toBe(200);
    expect(realStore.get(projectId)?.title).toBe("已重命名项目");
    expect(realStore.get(projectId)?.values.workspaceState).toBe(JSON.stringify(workspace));

    const rejected = await honoApp.request(`/api/video-remix/projects/${projectId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({
        workspace: {
          ...workspace,
          selectedShotAssets: { [sourceId]: crypto.randomUUID() },
        },
      }),
    });
    expect(rejected.status).toBe(422);
    expect(((await rejected.json()) as { error: { code: string } }).error.code).toBe("INVALID_REMIX_SELECTION");
  });

  test("does not expose another owner's project", async () => {
    const foreignProject = realStore.listRemixProjectRoots(otherUserId)[0];
    const response = await honoApp.request(`/api/video-remix/projects/${foreignProject?.id}`, { headers: headers() });
    expect(response.status).toBe(404);
  });

  test("reports a deleted optional voice accurately", async () => {
    const missingVoiceId = crypto.randomUUID();
    const response = await honoApp.request("/api/video-remix/project/generate", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(
        projectRequest("失效音色项目", {
          sourceAssetId: submissionSourceId,
          productImageAssetId: submissionProductAssetId,
          voiceAssetId: missingVoiceId,
        }),
      ),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: {
        code: "VOICE_ASSET_NOT_AVAILABLE",
        message: "引用的音色素材不存在或已删除",
        retryable: false,
      },
    });
  });

  test("creates video analysis without an optional voice", async () => {
    const response = await honoApp.request("/api/video-remix/project/generate", {
      method: "POST",
      headers: { ...headers(), "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(
        projectRequest("无音色项目", {
          sourceAssetId: submissionSourceId,
          productImageAssetId: submissionProductAssetId,
        }),
      ),
    });

    expect(response.status).toBe(202);
    const created = (await response.json()) as JobRecord;
    expect(created.values.workflowPhase).toBe("analysis");
    expect(created.values.voiceAssetId).toBe("");
  });
});
