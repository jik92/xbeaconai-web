import { describe, expect, test } from "bun:test";
import { getPortraitArkAssetUri, getPortraitById } from "../../server/portraits/catalog";
import { parsePortraitTags } from "../../shared/portraits/portrait-tags";
import { parseCustomPortrait, parsePortrait } from "../../web/features/portrait-library/portrait-data";

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
      display_url: "http://127.0.0.1:8787/api/portraits/18/content",
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

  test("uses persisted custom portrait gender without requiring tags in the name", () => {
    expect(
      parseCustomPortrait({
        type: "custom",
        assetId: "00000000-0000-4000-8000-000000000001",
        name: "小林",
        gender: "女",
        description: "自然亲切的生活方式博主",
        imageUrl: "/api/assets/portrait/content",
        status: "active",
        createdAt: "2026-07-26T00:00:00.000Z",
        updatedAt: "2026-07-26T00:00:00.000Z",
      }),
    ).toMatchObject({
      name: "小林",
      gender: "女",
      description: "自然亲切的生活方式博主",
      profession: "自建人像",
    });
  });

  test("converts a general portrait source URL into an Ark asset URI", () => {
    const portrait = getPortraitById(1);
    if (!portrait) throw new Error("portrait fixture missing");
    expect(getPortraitArkAssetUri(portrait)).toMatch(/^asset:\/\/asset-[a-zA-Z0-9-]+$/u);
  });
});
