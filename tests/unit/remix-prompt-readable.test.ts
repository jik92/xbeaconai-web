import { describe, expect, test } from "bun:test";
import { formatRemixPromptSections } from "../../web/features/video-remix/prompt-readable";

describe("remix prompt readable view", () => {
  test("separates a Seedance prompt into readable sections and timeline rows", () => {
    expect(
      formatRemixPromptSections(
        "第一部分：全局设定\n人物与商品保持一致。\n第二部分：时间轴与画面设计\n0–5秒｜原文口播：快闪开！｜画面设计：真人口播主镜。| 5–10秒｜原文口播：这条裤子全溜出来了。｜画面设计：商品特写插入镜。\n第三部分：产品一致性\n颜色和版型保持一致。",
      ),
    ).toEqual([
      expect.objectContaining({ title: "全局设定", rows: ["人物与商品保持一致。"] }),
      expect.objectContaining({
        title: "时间轴与画面设计",
        rows: [
          "0–5秒｜原文口播：快闪开！｜画面设计：真人口播主镜。",
          "5–10秒｜原文口播：这条裤子全溜出来了。｜画面设计：商品特写插入镜。",
        ],
      }),
      expect.objectContaining({ title: "产品一致性", rows: ["颜色和版型保持一致。"] }),
    ]);
  });

  test("keeps unstructured legacy prompts readable instead of rendering one dense line", () => {
    expect(
      formatRemixPromptSections("原文口播：第一句｜画面设计：真人口播。| 原文口播：第二句｜画面设计：商品特写。"),
    ).toEqual([
      { title: "提示词", rows: ["原文口播：第一句｜画面设计：真人口播。", "原文口播：第二句｜画面设计：商品特写。"] },
    ]);
  });

  test("recognizes section markers and sentence boundaries even when the model omits line breaks", () => {
    expect(
      formatRemixPromptSections(
        "第一部分：全局设定 人物出镜。商品严格对齐上传图；背景保持中性。第二部分：时间轴与画面设计 00:00–00:02｜原文口播：快闪开！｜画面设计：真人口播。第三部分：产品一致性 颜色和版型一致。",
      ),
    ).toEqual([
      expect.objectContaining({ title: "全局设定", rows: ["人物出镜。", "商品严格对齐上传图", "背景保持中性。"] }),
      expect.objectContaining({
        title: "时间轴与画面设计",
        rows: ["00:00–00:02｜原文口播：快闪开！｜画面设计：真人口播。"],
      }),
      expect.objectContaining({ title: "产品一致性", rows: ["颜色和版型一致。"] }),
    ]);
  });
});
