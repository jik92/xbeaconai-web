import { describe, expect, test } from "bun:test";
import { prepareVideoEditorSource } from "../../web/features/video-editor/video-editor-upload";

describe("video editor CDN source preparation", () => {
  test("uploads before probing metadata and stores the returned CDN original", async () => {
    const events: string[] = [];
    const file = new File(["video"], "source.mp4", { type: "video/mp4" });

    const source = await prepareVideoEditorSource(file, {
      upload: async () => {
        events.push("upload");
        return {
          id: "00000000-0000-4000-8000-000000000001",
          originalUrl: "https://files.xbeaconai.com/users/demo/source.mp4",
        };
      },
      readMetadata: async (url) => {
        events.push(`metadata:${url}`);
        return { duration: 12, width: 1920, height: 1080 };
      },
    });

    expect(events).toEqual(["upload", "metadata:https://files.xbeaconai.com/users/demo/source.mp4"]);
    expect(source).toEqual({
      assetId: "00000000-0000-4000-8000-000000000001",
      name: "source.mp4",
      url: "https://files.xbeaconai.com/users/demo/source.mp4",
      durationSec: 12,
      width: 1920,
      height: 1080,
    });
  });

  test("rejects an upload response without the exact media CDN origin", async () => {
    const file = new File(["video"], "source.mp4", { type: "video/mp4" });
    let metadataCalls = 0;

    await expect(
      prepareVideoEditorSource(file, {
        upload: async () => ({
          id: "00000000-0000-4000-8000-000000000001",
          originalUrl: "https://xbeacon-shanghai.tos-cn-shanghai.volces.com/users/demo/source.mp4",
        }),
        readMetadata: async () => {
          metadataCalls += 1;
          return { duration: 12, width: 1920, height: 1080 };
        },
      }),
    ).rejects.toThrow("视频上传完成，但未返回 CDN 地址");
    expect(metadataCalls).toBe(0);
  });
});
