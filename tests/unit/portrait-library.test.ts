import { describe, expect, test } from "bun:test";
import portraits from "../../public/portraits.json";

describe("portrait library manifest", () => {
  test("integrates the complete downloaded portrait pack", () => {
    expect(portraits).toHaveLength(1125);
    expect(portraits[0]).toMatchObject({ index: 1, category: "通用虚拟人像" });
    expect(portraits.every((portrait) => portrait.name && portrait.description && portrait.source_url)).toBe(true);
  });
});
