import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { AccountStore, MediaAsset } from "../../server/accounts/account-store";
import type { JobRecord } from "../../server/types";
import { createMediaUnderstandJob } from "../../worker/jobs/job-media-understand";
import type { JobHandlerContext } from "../../worker/jobs/types";

const ownerUserId = crypto.randomUUID();
const primaryId = crypto.randomUUID();
const referenceId = crypto.randomUUID();

function resultJson() {
  return JSON.stringify({
    title: "透明玻璃大茶缸镜头脚本",
    source_summary: "原素材展示皮带",
    replacement_brief: "替换为玻璃大茶缸",
    global_settings: { product: "透明玻璃大茶缸", audience: "家庭用户", tone: "自然", duration_seconds: 5 },
    shots: [
      {
        shot_number: 1,
        start_seconds: 0,
        end_seconds: 5,
        duration_seconds: 5,
        visual: "人物展示透明玻璃大茶缸",
        original_dialogue: "这条皮带很结实",
        rewritten_dialogue: "这个透明大茶缸容量真够用",
        action: "双手展示杯身",
        shot_type: "中近景",
        camera_movement: "固定",
        transition: "直接切入",
        product_replacement: "皮带替换为玻璃杯",
        audio: "自然口播",
      },
    ],
  });
}

function makeAsset(id: string, mimeType: string, storageKey: string): MediaAsset {
  return {
    id,
    ownerUserId,
    storageKey,
    originalName: id,
    mimeType,
    byteSize: 1024,
    kind: mimeType.startsWith("image/") ? "product" : "media",
    displayName: id,
    createdAt: new Date().toISOString(),
  };
}

function makeJob(cancelRequested = false): JobRecord {
  const request = {
    modelId: "doubao-seed-2-0-lite-260428",
    reasoningEffort: "high",
    prompt: "把皮带改成透明玻璃大茶缸",
    primaryAssetId: primaryId,
    referenceImageAssetIds: [referenceId],
    idempotencyKey: crypto.randomUUID(),
  };
  return {
    id: crypto.randomUUID(),
    ownerUserId,
    moduleId: "media-understand",
    title: "素材理解",
    status: "queued",
    progress: 0,
    stage: "排队中",
    overallExecutionMode: "real",
    values: { mediaUnderstandRequest: JSON.stringify(request) },
    executionPlan: [],
    provenance: [],
    cancelRequested,
    providerCancelState: "none",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeContext(job: JobRecord) {
  let current = job;
  const assets = new Map<string, MediaAsset>([
    [primaryId, makeAsset(primaryId, "video/mp4", `${ownerUserId}/media/source.mp4`)],
    [referenceId, makeAsset(referenceId, "image/png", `${ownerUserId}/products/cup.png`)],
  ]);
  const accounts = {
    getOwnedAsset: (userId: string, assetId: string) => (userId === ownerUserId ? assets.get(assetId) : undefined),
    getUser: () => ({ id: ownerUserId }),
    taskNotificationsEnabled: () => false,
  } as unknown as AccountStore;
  const context = {
    accounts,
    store: { get: () => current },
    change: (_id: string, patch: Partial<JobRecord>) => {
      current = { ...current, ...patch, updatedAt: new Date().toISOString() };
      return current;
    },
  } as unknown as JobHandlerContext;
  return { context, current: () => current, assets };
}

const loadMedia = async (asset: { id: string }) => `/tmp/${asset.id}`;
const uploadMedia = async (asset: { id: string }) => `file-${asset.id}`;
const deleteMedia = async () => {};

describe("media understanding worker", () => {
  test("calls Ark with uploaded media IDs and saves a validated JSON artifact", async () => {
    const calls: unknown[] = [];
    const deletedFileIds: string[] = [];
    let workerTempDir = "";
    const handler = createMediaUnderstandJob({
      client: {
        configured: true,
        analyze: async (input) => {
          calls.push(input);
          return {
            text: resultJson(),
            responseId: "resp-1",
            model: "doubao-seed-2-0-lite-260428",
            usage: { total_tokens: 100 },
          };
        },
      },
      loadMedia: async (asset, tempDir) => {
        workerTempDir = tempDir;
        return loadMedia(asset);
      },
      uploadMedia,
      deleteMedia: async (fileId) => {
        deletedFileIds.push(fileId);
      },
    });
    const job = makeJob();
    const state = makeContext(job);
    await handler.execute(job, state.context);
    expect(calls[0]).toMatchObject({
      model: "doubao-seed-2-0-lite-260428",
      media: [
        { kind: "video", fileId: `file-${primaryId}` },
        { kind: "image", fileId: `file-${referenceId}` },
      ],
    });
    expect(state.current().status).toBe("succeeded");
    expect(state.current().providerTaskId).toBe("resp-1");
    expect(state.current().result?.artifacts[0]).toMatchObject({
      mimeType: "application/json",
      executionMode: "real",
    });
    expect(JSON.parse(state.current().result?.artifacts[0]?.text ?? "").shots).toHaveLength(1);
    expect(deletedFileIds).toEqual([`file-${primaryId}`, `file-${referenceId}`]);
    expect(workerTempDir).not.toBe("");
    expect(existsSync(workerTempDir)).toBe(false);
  });

  test("retries one malformed model response with the same media", async () => {
    let calls = 0;
    const handler = createMediaUnderstandJob({
      client: {
        configured: true,
        analyze: async () => ({
          text: ++calls === 1 ? "not json" : resultJson(),
          responseId: `resp-${calls}`,
          model: "doubao-seed-2-0-lite-260428",
        }),
      },
      loadMedia,
      uploadMedia,
      deleteMedia,
    });
    const job = makeJob();
    const state = makeContext(job);
    await handler.execute(job, state.context);
    expect(calls).toBe(2);
    expect(state.current().status).toBe("succeeded");
  });

  test("cancels before calling Ark", async () => {
    let called = false;
    const handler = createMediaUnderstandJob({
      client: {
        configured: true,
        analyze: async () => {
          called = true;
          return { text: resultJson(), model: "doubao-seed-2-0-lite-260428" };
        },
      },
      loadMedia,
      uploadMedia,
      deleteMedia,
    });
    const job = makeJob(true);
    const state = makeContext(job);
    await handler.execute(job, state.context);
    expect(called).toBe(false);
    expect(state.current().status).toBe("cancelled");
  });

  test("fails when an owned reference disappears before execution", async () => {
    const handler = createMediaUnderstandJob({
      client: {
        configured: true,
        analyze: async () => ({ text: resultJson(), model: "doubao-seed-2-0-lite-260428" }),
      },
      loadMedia,
      uploadMedia,
      deleteMedia,
    });
    const job = makeJob();
    const state = makeContext(job);
    state.assets.delete(referenceId);
    await handler.execute(job, state.context);
    expect(state.current().status).toBe("failed");
    expect(state.current().error?.code).toBe("MEDIA_UNDERSTAND_REFERENCE_NOT_FOUND");
  });
});
