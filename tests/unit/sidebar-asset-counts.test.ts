import { describe, expect, test } from "bun:test";
import { assetSidebarCounts } from "../../web/components/domain/app-shell";

describe("sidebar asset counts", () => {
  test("maps every loaded asset collection to a visible count including empty libraries", () => {
    expect(
      assetSidebarCounts({
        materials: [{ id: "material-1" }, { id: "material-2" }],
        portraits: [{ index: 1 }, { index: 2 }, { index: 3 }],
        products: [],
        scenes: Array.from({ length: 47 }),
        voices: [{ id: "voice-1" }],
      }),
    ).toEqual({
      materials: "2",
      portraits: "3",
      products: "0",
      scenes: "47",
      voices: "1",
    });
  });

  test("omits only collections that have not loaded or failed", () => {
    expect(
      assetSidebarCounts({
        materials: undefined,
        portraits: [{ index: 1 }],
        products: undefined,
        voices: [],
      }),
    ).toEqual({
      portraits: "1",
      voices: "0",
    });
  });
});
