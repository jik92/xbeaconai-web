import { describe, expect, test } from "bun:test";
import {
  AiGenerateRequestSchema,
  normalizeAiGenerateValues,
  parseAiGenerateJobValues,
} from "../../server/creation/ai-generate-contract";

const imageAssetId = "11111111-1111-4111-8111-111111111111";
const videoAssetId = "22222222-2222-4222-8222-222222222222";
const parentJobId = "33333333-3333-4333-8333-333333333333";

describe("AI creation request contract", () => {
  test("round-trips an image edit without permitting execution controls", () => {
    const request = AiGenerateRequestSchema.parse({
      kind: "image",
      title: "商品主图",
      prompt: "保留商品外观，改成白色摄影棚",
      modelId: "gpt-image-1-mini",
      ratio: "1:1",
      resolution: "1k",
      count: 1,
      referenceAssetIds: [imageAssetId],
      parentJobId,
      revisionMode: "edit",
    });

    expect(parseAiGenerateJobValues(normalizeAiGenerateValues(request))).toEqual(request);
    expect(
      AiGenerateRequestSchema.safeParse({
        ...request,
        provider: "untrusted-provider",
        allowMockFallback: true,
      }).success,
    ).toBe(false);
  });

  test("keeps video-only duration and reference mode out of image requests", () => {
    expect(
      AiGenerateRequestSchema.safeParse({
        kind: "image",
        title: "商品主图",
        prompt: "白色摄影棚",
        modelId: "gpt-image-1-mini",
        ratio: "1:1",
        resolution: "1k",
        count: 1,
        duration: 5,
        referenceMode: "omni",
        referenceAssetIds: [],
        revisionMode: "new",
      }).success,
    ).toBe(false);
  });

  test("round-trips a Seedance video request with owned reference IDs", () => {
    const request = AiGenerateRequestSchema.parse({
      kind: "video",
      title: "商品短片",
      prompt: "镜头环绕商品一周",
      modelId: "doubao-seedance-1-5-pro-250528",
      ratio: "16:9",
      resolution: "720p",
      duration: 5,
      referenceMode: "omni",
      referenceAssetIds: [imageAssetId, videoAssetId],
      revisionMode: "variant",
    });

    expect(parseAiGenerateJobValues(normalizeAiGenerateValues(request))).toEqual(request);
  });

  test("rejects malformed persisted values instead of guessing defaults", () => {
    expect(() =>
      parseAiGenerateJobValues({
        kind: "image",
        title: "商品主图",
        prompt: "白色摄影棚",
        modelId: "gpt-image-1-mini",
        ratio: "1:1",
        resolution: "1k",
        count: "1",
        referenceAssetIds: "not-json",
        revisionMode: "new",
      }),
    ).toThrow("AI_GENERATE_VALUES_INVALID");
  });
});
