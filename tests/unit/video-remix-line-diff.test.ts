import { describe, expect, test } from "bun:test";
import { buildLineDiff } from "../../web/features/video-remix/line-diff";

describe("buildLineDiff", () => {
  test("marks removed and added lines while preserving shared lines", () => {
    const diff = buildLineDiff("开场\n旧口播\n收尾", "开场\n新口播\n收尾");

    expect(diff.before).toEqual([
      { lineNumber: 1, text: "开场", kind: "unchanged" },
      { lineNumber: 2, text: "旧口播", kind: "removed" },
      { lineNumber: 3, text: "收尾", kind: "unchanged" },
    ]);
    expect(diff.after).toEqual([
      { lineNumber: 1, text: "开场", kind: "unchanged" },
      { lineNumber: 2, text: "新口播", kind: "added" },
      { lineNumber: 3, text: "收尾", kind: "unchanged" },
    ]);
  });
});
