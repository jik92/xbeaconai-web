import { describe, expect, test } from "bun:test";
import {
  normalizeVideoEditorTimeline,
  removeVideoEditorSource,
  timelineDuration,
  validateVideoEditorTimeline,
  type VideoEditorTimeline,
} from "../../shared/video-editor/timeline";

const timeline: VideoEditorTimeline = {
  version: 1,
  fps: 30,
  width: 1920,
  height: 1080,
  sources: [
    { id: "source", assetId: "asset", name: "source.mp4", url: "", durationSec: 10, width: 1920, height: 1080 },
  ],
  clips: [
    { id: "a", sourceId: "source", name: "A", inSec: 1, outSec: 4 },
    { id: "b", sourceId: "source", name: "B", inSec: 6, outSec: 9 },
  ],
};

describe("video editor timeline", () => {
  test("calculates the composed duration", () => expect(timelineDuration(timeline)).toBe(6));
  test("accepts valid owned-source-shaped clips", () => expect(validateVideoEditorTimeline(timeline)).toBeUndefined());
  test("rejects a clip outside its source", () =>
    expect(validateVideoEditorTimeline({ ...timeline, clips: [{ ...timeline.clips[0]!, outSec: 11 }] })).toBe(
      "片段时间范围无效",
    ));
  test("replaces persisted blob URLs with stable authenticated asset URLs", () => {
    const normalized = normalizeVideoEditorTimeline({
      ...timeline,
      sources: [{ ...timeline.sources[0]!, url: "blob:http://127.0.0.1/stale" }],
    });
    expect(normalized.sources[0]?.url).toBe("/api/assets/asset/content");
    expect(JSON.stringify(normalized)).not.toContain("blob:");
  });
  test("removes a source together with all clips that reference it", () => {
    const removed = removeVideoEditorSource(timeline, "source");
    expect(removed.removedClipIds).toEqual(["a", "b"]);
    expect(removed.timeline.sources).toHaveLength(0);
    expect(removed.timeline.clips).toHaveLength(0);
  });
});
