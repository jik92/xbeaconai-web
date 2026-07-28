import { describe, expect, test } from "bun:test";
import { persistArtifactMedia } from "../../server/storage/artifact-public-media";

const userId = "00000000-0000-4000-8000-000000000001";
const artifactId = "00000000-0000-4000-8000-000000000002";
const jobId = "00000000-0000-4000-8000-000000000003";

describe("artifact CDN persistence", () => {
  test("uploads a local media artifact once and registers it as an owned TOS asset", async () => {
    const events: string[] = [];
    const result = await persistArtifactMedia(
      { userId, artifactId },
      {
        getOwnedAsset: () => undefined,
        getArtifact: () => ({
          storageKey: "job-result.mp4",
          name: "最终 成片.mp4",
          mimeType: "video/mp4",
          jobId,
        }),
        getDefaultFolder: () => ({
          id: "00000000-0000-4000-8000-000000000004",
          storagePrefix: `${userId}/materials/default/`,
        }),
        getLocalFile: () => ({ path: "/data/results/job-result.mp4", size: 4096, exists: true }),
        upload: async (input) => {
          events.push(`upload:${input.key}:${input.mimeType}:${input.sizeBytes}`);
        },
        createAsset: (asset) => {
          events.push(`asset:${asset.id}:${asset.storageKey}:${asset.folderId}`);
        },
        now: () => "2026-07-28T12:00:00.000Z",
      },
    );

    expect(result?.storageKey).toBe(`${userId}/materials/default/generated/${jobId}/${artifactId}.mp4`);
    expect(events).toEqual([
      `upload:${userId}/materials/default/generated/${jobId}/${artifactId}.mp4:video/mp4:4096`,
      `asset:${artifactId}:${userId}/materials/default/generated/${jobId}/${artifactId}.mp4:00000000-0000-4000-8000-000000000004`,
    ]);
  });

  test("reuses an existing TOS asset without uploading the local file again", async () => {
    let uploadCalls = 0;
    const existing = {
      id: artifactId,
      ownerUserId: userId,
      storageKey: `${userId}/materials/default/generated/${jobId}/${artifactId}.mp4`,
      originalName: "最终成片.mp4",
      mimeType: "video/mp4",
      byteSize: 4096,
      kind: "media" as const,
      displayName: "最终成片.mp4",
      createdAt: "2026-07-28T12:00:00.000Z",
    };
    const result = await persistArtifactMedia(
      { userId, artifactId },
      {
        getOwnedAsset: () => existing,
        getArtifact: () => undefined,
        getDefaultFolder: () => undefined,
        getLocalFile: () => undefined,
        upload: async () => {
          uploadCalls += 1;
        },
        createAsset: () => undefined,
        now: () => "2026-07-28T12:00:00.000Z",
      },
    );

    expect(result).toBe(existing);
    expect(uploadCalls).toBe(0);
  });

  test("does not publish a local text artifact as CDN media", async () => {
    const result = await persistArtifactMedia(
      { userId, artifactId },
      {
        getOwnedAsset: () => undefined,
        getArtifact: () => ({
          storageKey: "result.txt",
          name: "result.txt",
          mimeType: "text/plain",
          jobId,
        }),
        getDefaultFolder: () => ({
          id: "00000000-0000-4000-8000-000000000004",
          storagePrefix: `${userId}/materials/default/`,
        }),
        getLocalFile: () => ({ path: "/data/results/result.txt", size: 16, exists: true }),
        upload: async () => {
          throw new Error("text must not be uploaded");
        },
        createAsset: () => {
          throw new Error("text must not become an asset");
        },
        now: () => "2026-07-28T12:00:00.000Z",
      },
    );

    expect(result).toBeUndefined();
  });
});
