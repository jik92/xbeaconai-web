import { describe, expect, test } from "bun:test";
import {
  fitMediaPreviewSize,
  resolveMediaPreviewContentSize,
} from "../../web/features/asset-library/media-preview-size";

describe("asset media preview sizing", () => {
  test("fits portrait media inside the preview without cropping", () => {
    expect(fitMediaPreviewSize(720, 1280)).toEqual({ width: 40.5, height: 72 });
  });

  test("keeps the interactive video frame at full 16:9 size while the video itself uses contain", () => {
    expect(resolveMediaPreviewContentSize("video/mp4", { width: 40.5, height: 72 })).toEqual({
      width: "100%",
      height: "100%",
    });
  });

  test("keeps the fitted dimensions for an image preview", () => {
    expect(resolveMediaPreviewContentSize("image/png", { width: 40.5, height: 72 })).toEqual({
      width: 40.5,
      height: 72,
    });
  });

  test("fits square images without stretching them to landscape", () => {
    expect(fitMediaPreviewSize(800, 800)).toEqual({ width: 72, height: 72 });
  });

  test("uses the complete preview slot for matching landscape media", () => {
    expect(fitMediaPreviewSize(1920, 1080)).toEqual({ width: 128, height: 72 });
  });

  test("falls back to intrinsic media sizing when metadata is missing", () => {
    expect(fitMediaPreviewSize(undefined, undefined)).toBeUndefined();
  });
});
