import { describe, expect, test } from "bun:test";
import type { Job } from "../../web/api/generated/types.gen";
import {
  type AiGenerateDraft,
  type AiGenerateReference,
  buildAiGenerateValues,
  jobsToThreadMessages,
  resolveAssetMentions,
} from "../../web/features/ai-generate/ai-generate-runtime";

const reference: AiGenerateReference = {
  id: "asset-1",
  name: "商品图.png",
  mimeType: "image/png",
  label: "图片1",
  source: "library",
};

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
      creationKind: "image",
      modelId: "seedream-5-pro",
      ratio: "1:1",
      resolution: "2k",
      count: "1",
      references: JSON.stringify([reference]),
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
      modelId: "seedream-5-pro",
      ratio: "1:1",
      resolution: "2k",
      count: 1,
      duration: 5,
      seed: "",
      referenceMode: "",
      references: [reference],
      parentJobId: "job-parent",
      revisionMode: "edit",
    };

    expect(buildAiGenerateValues(draft)).toMatchObject({
      type: "图片",
      creationKind: "image",
      prompt: "改成夜景，保留 @图片1",
      parentJobId: "job-parent",
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
