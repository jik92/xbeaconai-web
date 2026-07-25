import { describe, expect, test } from "bun:test";
import { parsePortraitTags } from "../../shared/portraits/portrait-tags";
import { getPortraitArkAssetUri, getPortraitById } from "../../server/portraits/catalog";
import { parsePortrait } from "../../web/features/portrait-library/portrait-data";

describe("portrait library data", () => {
  test("normalizes portrait metadata for both the library page and remix modal", () => {
    expect(
      parsePortrait({
        index: 18,
        category: "通用",
        page: 2,
        name: "示例 32岁 女性 主播",
        description: "自然口播人像",
        source_url: "/portrait.png",
        file: "portrait.png",
      }),
    ).toMatchObject({
      age: 32,
      gender: "女",
      profession: "主播",
      display_url: "/api/portraits/18/content",
    });
  });

  test("parses the exact portrait identity tags without guessing malformed names", () => {
    expect(parsePortraitTags("中国 22岁 男 牙医")).toEqual({
      country: "中国",
      age: 22,
      gender: "男",
      profession: "牙医",
    });
    expect(parsePortraitTags("示例 32岁 女性 主播")?.gender).toBe("女");
    expect(parsePortraitTags("没有结构化标签的人像")).toBeUndefined();
  });

  test("converts a general portrait source URL into an Ark asset URI", () => {
    const portrait = getPortraitById(1);
    if (!portrait) throw new Error("portrait fixture missing");
    expect(getPortraitArkAssetUri(portrait)).toMatch(/^asset:\/\/asset-[a-zA-Z0-9-]+$/u);
  });
});
