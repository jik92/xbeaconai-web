import { describe, expect, test } from "bun:test";
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
    ).toMatchObject({ age: 32, gender: "女", profession: "主播" });
  });
});
