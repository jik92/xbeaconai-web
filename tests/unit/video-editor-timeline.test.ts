import { describe, expect, test } from "bun:test";
import {
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
});
