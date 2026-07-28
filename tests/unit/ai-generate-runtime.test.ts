import { describe, expect, test } from "bun:test";
import type { Job } from "../../web/api/generated/types.gen";
import {
  type AiGenerateDraft,
  type AiGenerateReference,
  buildAiGenerateRequest,
  countEffectiveReferences,
  jobsToThreadMessages,
  referencesFromAppendMessage,
  resolveAssetMentions,
  validateModelReferenceCount,
} from "../../web/features/ai-generate/ai-generate-runtime";

const reference: AiGenerateReference = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "商品图.png",
  mimeType: "image/png",
  label: "图片1",
  source: "library",
};

test("blocks reference counts outside the selected real model capability", () => {
  expect(validateModelReferenceCount({ minReferences: 1, maxReferences: 1 }, 0)).toBe("该模型至少需要 1 张参考图");
  expect(validateModelReferenceCount({ minReferences: 0, maxReferences: 0 }, 1)).toBe("该模型最多支持 0 张参考图");
  expect(validateModelReferenceCount({ minReferences: 0, maxReferences: 12 }, 2)).toBeUndefined();
});

test("counts a parent result as the implicit reference only when no explicit references are attached", () => {
  expect(countEffectiveReferences(0, "parent-job", "edit")).toBe(1);
  expect(countEffectiveReferences(0, "parent-job", "variant")).toBe(1);
  expect(countEffectiveReferences(2, "parent-job", "edit")).toBe(2);
  expect(countEffectiveReferences(0, "parent-job", "new")).toBe(0);
});

function job(patch: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    moduleId: "ai-generate",
    title: "图片创作",
    status: "succeeded",
    progress: 100,
    stage: "已完成",
    overallExecutionMode: "real",
    values: {
      prompt: "让 @图片1 出现在海边",
      kind: "image",
      modelId: "gpt-image-1-mini",
      ratio: "1:1",
      resolution: "1k",
      count: "1",
      referenceAssetIds: JSON.stringify([reference.id]),
      referenceMetadata: JSON.stringify([reference]),
    },
    executionPlan: [],
    provenance: [],
    cancelRequested: false,
    stagingKeys: [],
    jobSchemaVersion: 2,
    result: {
      kind: "ai-generate",
      title: "图片创作",
      summary: "生成完成",
      artifacts: [
        {
          id: "artifact-1",
          name: "result.png",
          mimeType: "image/png",
          url: "/api/artifacts/artifact-1",
          executionMode: "real",
          lineage: [],
        },
      ],
      data: { values: {}, generatedAt: "2026-07-26T08:00:00.000Z", mock: false },
    },
    createdAt: "2026-07-26T08:00:00.000Z",
    updatedAt: "2026-07-26T08:01:00.000Z",
    ...patch,
  };
}

describe("AI Generate assistant runtime", () => {
  test("submits selected attachment references from the assistant-ui message", () => {
    const message = {
      role: "user",
      content: [{ type: "text", text: "给我一个跳舞的小狗带着这个帽子" }],
      attachments: [
        {
          id: reference.id,
          type: "图片",
          name: `@${reference.label} · ${reference.name}`,
          contentType: reference.mimeType,
          status: { type: "complete" },
          content: [{ type: "data", name: "ai-generate-reference", data: reference }],
        },
      ],
      createdAt: new Date(),
      parentId: null,
      sourceId: null,
      runConfig: undefined,
      metadata: { custom: {} },
    } as Parameters<typeof referencesFromAppendMessage>[0];

    const extracted = referencesFromAppendMessage(message);
    expect(extracted).toEqual([reference]);
    expect(
      buildAiGenerateRequest(
        {
          kind: "video",
          prompt: "给我一个跳舞的小狗带着这个帽子",
          modelId: "doubao-seedance-2-0-mini-260615",
          ratio: "9:16",
          resolution: "720p",
          count: 1,
          duration: 5,
          seed: "",
          referenceMode: "omni",
          references: extracted,
          revisionMode: "new",
        },
        "视频创作",
      ).referenceAssetIds,
    ).toEqual([reference.id]);
  });

  test("resolves exact @ asset labels and reports unresolved mentions", () => {
    expect(resolveAssetMentions("让 @图片1 跟随 @视频1 的动作", [reference])).toEqual({
      references: [reference],
      unresolved: ["@视频1"],
    });
  });

  test("builds a real revision request with parent lineage", () => {
    const draft: AiGenerateDraft = {
      kind: "image",
      prompt: "改成夜景，保留 @图片1",
      modelId: "gpt-image-1-mini",
      ratio: "1:1",
      resolution: "1k",
      count: 1,
      duration: 5,
      seed: "",
      referenceMode: "",
      references: [reference],
      parentJobId: "33333333-3333-4333-8333-333333333333",
      revisionMode: "edit",
    };

    expect(buildAiGenerateRequest(draft, "图片创作")).toEqual({
      kind: "image",
      title: "图片创作",
      prompt: "改成夜景，保留 @图片1",
      modelId: "gpt-image-1-mini",
      ratio: "1:1",
      resolution: "1k",
      count: 1,
      referenceAssetIds: [reference.id],
      parentJobId: "33333333-3333-4333-8333-333333333333",
      revisionMode: "edit",
    });
  });

  test("maps each persisted job to stable user and assistant messages", () => {
    const messages = jobsToThreadMessages([job()]);
    expect(messages.map((message) => [message.id, message.role])).toEqual([
      ["job-1:user", "user"],
      ["job-1:assistant", "assistant"],
    ]);
    expect(messages[1]?.content).toEqual([
      {
        type: "data",
        name: "ai-generate-result",
        data: expect.objectContaining({ jobId: "job-1", status: "succeeded", progress: 100 }),
      },
    ]);
  });
});
