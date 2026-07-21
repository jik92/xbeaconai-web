import { describe, expect, test } from "bun:test";
import {
  planMashupCombinations,
  theoreticalCombinationCount,
  type VideoMashupConfig,
  validateVideoMashupConfig,
} from "../../shared/video-mashup/config";

const config = (mode: VideoMashupConfig["combinationMode"] = "max-results"): VideoMashupConfig => ({
  version: 1,
  groups: [
    { id: "a", name: "A", assetIds: ["a1", "a2"] },
    { id: "b", name: "B", assetIds: ["b1", "b2"] },
  ],
  combinationMode: mode,
  resolution: "720P",
  count: 4,
  outputFolderId: "folder",
});

describe("video mashup planning", () => {
  test("calculates the cartesian product and stable lexical order", () => {
    const value = config();
    expect(theoreticalCombinationCount(value.groups)).toBe(4);
    expect(planMashupCombinations(value).map((item) => item.assetIds)).toEqual([
      ["a1", "b1"],
      ["a1", "b2"],
      ["a2", "b1"],
      ["a2", "b2"],
    ]);
  });

  test("maximizes difference deterministically", () => {
    const first = planMashupCombinations(config("max-difference"));
    const second = planMashupCombinations(config("max-difference"));
    expect(first).toEqual(second);
    expect(first[0]?.assetIds).toEqual(["a1", "b1"]);
    expect(first[1]?.assetIds).toEqual(["a2", "b2"]);
  });

  test("rejects empty, duplicate and excessive group inputs", () => {
    const empty = config();
    if (empty.groups[0]) empty.groups[0].assetIds = [];
    expect(validateVideoMashupConfig(empty)).toContain("必须选择");
    const duplicate = config();
    if (duplicate.groups[0]) duplicate.groups[0].assetIds = ["a1", "a1"];
    expect(validateVideoMashupConfig(duplicate)).toContain("重复素材");
    const excessive = config();
    excessive.count = 5;
    expect(validateVideoMashupConfig(excessive)).toContain("理论组合数");
  });
});
