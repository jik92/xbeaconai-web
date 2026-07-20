import { describe, expect, test } from "bun:test";
import { fitMediaPreviewSize } from "../../web/features/asset-library/media-preview-size";

describe("asset media preview sizing", () => {
  test("fits portrait video inside the preview without cropping", () => {
    expect(fitMediaPreviewSize(720, 1280)).toEqual({ width: 40.5, height: 72 });
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
