import { describe, expect, test } from "bun:test";
import { type SystemMediaManifestEntry, syncSystemMedia, systemMediaManifest } from "../../scripts/sync-system-media";

const entries: SystemMediaManifestEntry[] = [
  {
    storageKey: "system/scenes/1.jpg",
    mimeType: "image/jpeg",
    localPath: "/fixtures/1.jpg",
  },
  {
    storageKey: "system/scenes/2.jpg",
    mimeType: "image/jpeg",
    localPath: "/fixtures/2.jpg",
  },
  {
    storageKey: "system/portraits/3.png",
    mimeType: "image/png",
    sourceUrl: "https://source.example/3.png",
  },
];

describe("system media synchronization", () => {
  test("publishes the complete portrait and scene manifest", () => {
    const manifest = systemMediaManifest();
    expect(manifest.filter((entry) => entry.storageKey.startsWith("system/portraits/"))).toHaveLength(1125);
    expect(manifest.filter((entry) => entry.storageKey.startsWith("system/scenes/"))).toHaveLength(47);
    expect(new Set(manifest.map((entry) => entry.storageKey)).size).toBe(1172);
  });

  test("uploads only missing objects and verifies the final manifest", async () => {
    const existing = new Set(["system/scenes/1.jpg"]);
    const uploaded: string[] = [];

    expect(
      await syncSystemMedia({
        apply: true,
        concurrency: 2,
        entries,
        head: async (key) => existing.has(key),
        fetchBytes: async (entry) => ({
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: entry.mimeType,
        }),
        uploadBytes: async (entry) => {
          uploaded.push(entry.storageKey);
          existing.add(entry.storageKey);
        },
      }),
    ).toEqual({ checked: 3, uploaded: 2, missing: [] });
    expect(uploaded.sort()).toEqual(["system/portraits/3.png", "system/scenes/2.jpg"]);
  });

  test("reports missing objects without uploading in check mode", async () => {
    let uploadCount = 0;
    const result = await syncSystemMedia({
      apply: false,
      entries,
      head: async (key) => key === "system/scenes/1.jpg",
      fetchBytes: async () => {
        throw new Error("check mode must not fetch source bytes");
      },
      uploadBytes: async () => {
        uploadCount += 1;
      },
    });

    expect(result).toEqual({
      checked: 3,
      uploaded: 0,
      missing: ["system/portraits/3.png", "system/scenes/2.jpg"],
    });
    expect(uploadCount).toBe(0);
  });

  test("rejects mismatched source MIME types before upload", async () => {
    const entry = entries[0];
    if (!entry) throw new Error("system media fixture missing");
    expect(
      syncSystemMedia({
        apply: true,
        entries: [entry],
        head: async () => false,
        fetchBytes: async () => ({
          bytes: new Uint8Array([1]),
          mimeType: "text/html",
        }),
        uploadBytes: async () => undefined,
      }),
    ).rejects.toThrow("SYSTEM_MEDIA_MIME_MISMATCH");
  });
});
