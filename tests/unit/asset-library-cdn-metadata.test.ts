import { afterEach, describe, expect, test } from "bun:test";
import { inspectMediaUrl } from "../../web/features/asset-library/asset-library";

const originalImage = globalThis.Image;

afterEach(() => {
  globalThis.Image = originalImage;
});

describe("asset library CDN metadata", () => {
  test("reads image dimensions only after receiving the CDN URL", async () => {
    let assignedSource = "";
    class MetadataImage {
      naturalWidth = 1280;
      naturalHeight = 720;
      onload?: () => void;
      onerror?: () => void;
      set src(value: string) {
        assignedSource = value;
        queueMicrotask(() => this.onload?.());
      }
    }
    globalThis.Image = MetadataImage as unknown as typeof Image;

    await expect(inspectMediaUrl("https://files.xbeaconai.com/users/demo/source.jpg", "image/jpeg")).resolves.toEqual({
      width: 1280,
      height: 720,
    });
    expect(assignedSource).toBe("https://files.xbeaconai.com/users/demo/source.jpg");
  });

  test("rejects metadata reads from a non-CDN media address", async () => {
    await expect(
      inspectMediaUrl("/api/assets/00000000-0000-4000-8000-000000000001/content", "image/jpeg"),
    ).rejects.toThrow("素材上传完成，但未返回 CDN 地址");
  });
});
