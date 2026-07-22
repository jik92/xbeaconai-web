import { describe, expect, test } from "bun:test";
import { uploadFilesStrictly } from "../../server/storage/strict-library-upload";

describe("strict library upload", () => {
  test("rolls back completed objects and every staged file when an upload fails", async () => {
    const events: string[] = [];
    const items = ["first.png", "second.png", "third.png"].map((storageKey) => ({
      file: new File([storageKey], storageKey, { type: "image/png" }),
      localPath: `/tmp/${storageKey}`,
      storageKey,
      mimeType: "image/png",
      sizeBytes: storageKey.length,
    }));

    await expect(
      uploadFilesStrictly(items, {
        writeLocal: async (item) => {
          events.push(`write:${item.storageKey}`);
        },
        uploadObject: async (item) => {
          events.push(`upload:${item.storageKey}`);
          if (item.storageKey === "second.png") throw new Error("TOS upload failed");
        },
        deleteObject: async (key) => {
          events.push(`delete:${key}`);
        },
        removeLocal: async (path) => {
          events.push(`remove:${path}`);
        },
      }),
    ).rejects.toThrow("TOS upload failed");

    expect(events).toContain("delete:first.png");
    expect(events).not.toContain("write:third.png");
    expect(events.filter((event) => event.startsWith("remove:"))).toHaveLength(3);
  });
});
