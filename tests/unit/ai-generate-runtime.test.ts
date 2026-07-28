import { describe, expect, test } from "bun:test";
import type { Job } from "../../web/api/generated/types.gen";
import {
  type AiGenerateDraft,
  type AiGenerateReference,
  buildAiGenerateRequest,
  buildProfessionalPrompt,
  countEffectiveReferences,
  groupAiGenerateConversations,
  jobsToThreadMessages,
  parseProfessionalPrompt,
  referenceAccept,
  referencesFromAppendMessage,
  resolveAssetMentions,
  resolveReferenceMode,
  seedanceReferenceConstraints,
  supportsMediaReference,
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

test("maps a model reference capability to image and video attachment constraints", () => {
  expect(referenceAccept({ acceptedReferenceKinds: ["image", "video"] })).toBe("image/*,video/*");
  expect(referenceAccept({ acceptedReferenceKinds: ["image"] })).toBe("image/*");
  expect(referenceAccept({ acceptedReferenceKinds: [] })).toBe("");
  expect(supportsMediaReference({ acceptedReferenceKinds: ["video"] }, "video/mp4")).toBe(true);
  expect(supportsMediaReference({ acceptedReferenceKinds: ["video"] }, "image/png")).toBe(false);
});

test("publishes the visible Seedance limits for each supported reference type", () => {
  expect(seedanceReferenceConstraints({ acceptedReferenceKinds: ["image", "video"] })).toEqual(
    expect.objectContaining({ summary: expect.arrayContaining([expect.stringContaining("15.2")]) }),
  );
  expect(seedanceReferenceConstraints({ acceptedReferenceKinds: ["image"] })?.summary.join(" ")).not.toContain("15.2");
});

test("combines every professional field into the prompt sent to Seedance", () => {
  expect(buildProfessionalPrompt({ script: "商品环绕展示", environment: "摄影棚慢推镜", emphasis: "突出材质" })).toBe(
    "脚本：商品环绕展示\n环境与运镜：摄影棚慢推镜\n强调点：突出材质",
  );
});

test("identifies and restores professional prompts without changing concise prompts", () => {
  expect(parseProfessionalPrompt("脚本：商品环绕展示\n环境与运镜：摄影棚慢推镜\n强调点：突出材质")).toEqual({
    script: "商品环绕展示",
    environment: "摄影棚慢推镜",
    emphasis: "突出材质",
  });
  expect(parseProfessionalPrompt("一句简洁描述")).toBeUndefined();
});

test("restores a valid video reference mode when an older task did not persist one", () => {
  expect(resolveReferenceMode("video", "", ["omni"])).toBe("omni");
  expect(resolveReferenceMode("video", "omni", ["omni"])).toBe("omni");
  expect(resolveReferenceMode("image", "omni", [])).toBe("");
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
          url: "/api/artifacts/artifact-1/access",
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
      conversationId: "44444444-4444-4444-8444-444444444444",
      conversationName: "桑蚕丝女裤",
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
      conversationId: "44444444-4444-4444-8444-444444444444",
      conversationName: "桑蚕丝女裤",
      revisionMode: "edit",
    });
  });

  test("does not submit the virtual unclassified conversation as a UUID", () => {
    const request = buildAiGenerateRequest(
      {
        kind: "image",
        prompt: "为旧任务创建变体",
        modelId: "gpt-image-1-mini",
        ratio: "1:1",
        resolution: "1k",
        count: 1,
        duration: 5,
        seed: "",
        referenceMode: "",
        references: [],
        conversationId: "unclassified",
        conversationName: "未分类",
        revisionMode: "variant",
      },
      "图片创作",
    );

    expect(request).not.toHaveProperty("conversationId");
    expect(request).not.toHaveProperty("conversationName");
  });

  test("groups named products separately and keeps legacy tasks unclassified", () => {
    const named = job({
      id: "named-job",
      createdAt: "2026-07-27T08:00:00.000Z",
      values: {
        ...job().values,
        conversationId: "44444444-4444-4444-8444-444444444444",
        conversationName: "桑蚕丝女裤",
      },
    });

    expect(groupAiGenerateConversations([job(), named])).toEqual([
      expect.objectContaining({
        id: "44444444-4444-4444-8444-444444444444",
        name: "桑蚕丝女裤",
        jobs: [named],
      }),
      expect.objectContaining({ id: "unclassified", name: "未分类", jobs: [job()] }),
    ]);
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
