import { describe, expect, test } from "bun:test";
import {
  buildMediaUnderstandPrompt,
  extractMediaUnderstandResult,
  MediaUnderstandRequestSchema,
  mediaUnderstandModelIds,
  mediaUnderstandModels,
} from "../../shared/media-understand/contract";

describe("media understanding contract", () => {
  test("publishes only the four approved Seed models", () => {
    expect(mediaUnderstandModelIds).toEqual([
      "doubao-seed-2-0-pro-260215",
      "doubao-seed-2-1-pro-260628",
      "doubao-seed-2-0-lite-260428",
      "doubao-seed-2-0-mini-260428",
    ]);
  });

  test("keeps the real audio capability limited to the verified Lite and Mini versions", () => {
    expect(
      mediaUnderstandModels.filter((model) => model.acceptedPrimaryKinds.includes("audio")).map((model) => model.id),
    ).toEqual(["doubao-seed-2-0-lite-260428", "doubao-seed-2-0-mini-260428"]);
  });

  test("accepts one primary asset and up to five distinct product images", () => {
    const parsed = MediaUnderstandRequestSchema.parse({
      modelId: "doubao-seed-2-0-lite-260428",
      reasoningEffort: "high",
      prompt: "把皮带改成透明玻璃杯大茶缸",
      primaryAssetId: crypto.randomUUID(),
      referenceImageAssetIds: Array.from({ length: 5 }, () => crypto.randomUUID()),
      idempotencyKey: crypto.randomUUID(),
    });
    expect(parsed.referenceImageAssetIds).toHaveLength(5);
    expect(() =>
      MediaUnderstandRequestSchema.parse({
        ...parsed,
        referenceImageAssetIds: [...parsed.referenceImageAssetIds, crypto.randomUUID()],
      }),
    ).toThrow();
    expect(() =>
      MediaUnderstandRequestSchema.parse({
        ...parsed,
        referenceImageAssetIds: [parsed.primaryAssetId],
      }),
    ).toThrow();
  });

  test("builds a detailed JSON shot-script instruction from the replacement brief", () => {
    const prompt = buildMediaUnderstandPrompt({
      userPrompt: "然后将皮带改成茶杯，我要卖透明玻璃杯的大茶缸。",
      primaryMimeType: "video/mp4",
      referenceImageCount: 1,
    });
    expect(prompt).toContain("start_seconds");
    expect(prompt).toContain("original_dialogue");
    expect(prompt).toContain("rewritten_dialogue");
    expect(prompt).toContain("透明玻璃杯的大茶缸");
    expect(prompt).toContain("只返回一个合法 JSON 对象");
  });

  test("extracts and validates a fenced JSON shot script", () => {
    const result = extractMediaUnderstandResult(`\`\`\`json
{
  "title": "透明玻璃大茶缸带货镜头脚本",
  "source_summary": "原片展示皮带",
  "replacement_brief": "将皮带替换为透明玻璃大茶缸",
  "global_settings": {
    "product": "透明玻璃大茶缸",
    "audience": "家庭用户",
    "tone": "真实自然",
    "duration_seconds": 6
  },
  "shots": [{
    "shot_number": 1,
    "start_seconds": 0,
    "end_seconds": 6,
    "duration_seconds": 6,
    "visual": "人物拿起透明玻璃大茶缸",
    "original_dialogue": "这条皮带很结实",
    "rewritten_dialogue": "这个透明大茶缸容量真够用",
    "action": "双手展示杯身",
    "shot_type": "中近景",
    "camera_movement": "固定",
    "transition": "直接切入",
    "product_replacement": "将皮带替换为玻璃大茶缸",
    "audio": "保留自然环境声"
  }]
}
\`\`\``);
    expect(result.shots[0]?.end_seconds).toBe(6);
    expect(result.global_settings.product).toBe("透明玻璃大茶缸");
  });

  test("rejects overlapping or arithmetically inconsistent video shots", () => {
    const invalid = {
      title: "脚本",
      source_summary: "摘要",
      replacement_brief: "替换",
      global_settings: { product: "杯子", audience: "", tone: "", duration_seconds: 8 },
      shots: [
        {
          shot_number: 1,
          start_seconds: 0,
          end_seconds: 5,
          duration_seconds: 4,
          visual: "镜头一",
          original_dialogue: "",
          rewritten_dialogue: "口播一",
          action: "动作一",
          shot_type: "近景",
          camera_movement: "固定",
          transition: "无",
          product_replacement: "杯子",
          audio: "",
        },
        {
          shot_number: 2,
          start_seconds: 4,
          end_seconds: 8,
          duration_seconds: 4,
          visual: "镜头二",
          original_dialogue: "",
          rewritten_dialogue: "口播二",
          action: "动作二",
          shot_type: "近景",
          camera_movement: "固定",
          transition: "切镜",
          product_replacement: "杯子",
          audio: "",
        },
      ],
    };
    expect(() => extractMediaUnderstandResult(JSON.stringify(invalid))).toThrow();
  });
});
