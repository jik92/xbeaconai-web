import { describe, expect, test } from "bun:test";
import { suggestScriptRemixDuration } from "../../web/features/video-remix/script-remix-duration";

describe("script remix automatic duration", () => {
  test("uses original narration length to select the nearest supported Seedance duration", () => {
    expect(suggestScriptRemixDuration("原文口播：这是一句简短的商品介绍。", [5, 10, 15])).toBe(5);
    expect(
      suggestScriptRemixDuration(
        "原文口播：这条裤子面料很舒服，夏天穿也不会闷热，腰部设计显瘦，搭配短袖和凉鞋就能直接出门，日常通勤和约会都很合适。",
        [5, 10, 15],
      ),
    ).toBe(15);
  });

  test("falls back to the existing default when an older prompt has no narration marker", () => {
    expect(suggestScriptRemixDuration("旧版提示词没有可识别的口播字段。", [5, 10, 15], 15)).toBe(15);
  });

  test("never rounds an estimated duration down to a shorter supported duration", () => {
    expect(suggestScriptRemixDuration(`原文口播：${"裤".repeat(40)}`, [5, 10, 15])).toBe(15);
  });
});
