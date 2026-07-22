import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import type { MediaAsset } from "../../server/accounts/account-store";
import { materializeRemixAnalysisAssets } from "../../worker/jobs/video-remix-assets";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function asset(input: Pick<MediaAsset, "id" | "storageKey" | "originalName" | "mimeType" | "kind">): MediaAsset {
  return {
    ...input,
    ownerUserId: "owner-1",
    byteSize: 10,
    displayName: input.originalName,
    createdAt: new Date(0).toISOString(),
  };
}

async function directories() {
  const root = await mkdtemp(resolve(tmpdir(), "video-remix-assets-test-"));
  tempDirs.push(root);
  const uploadRoot = resolve(root, "uploads");
  const tempDir = resolve(root, "task");
  await Promise.all([mkdir(uploadRoot), mkdir(tempDir)]);
  return { uploadRoot, tempDir };
}

describe("video remix remote assets", () => {
  test("downloads a remote video and all remote product images into the task directory", async () => {
    const paths = await directories();
    const downloads: string[] = [];
    const result = await materializeRemixAnalysisAssets({
      ...paths,
      videoAsset: asset({
        id: "video-1",
        storageKey: "owner/materials/video.mp4",
        originalName: "source.mp4",
        mimeType: "video/mp4",
        kind: "media",
      }),
      referenceAssets: [
        asset({
          id: "image-1",
          storageKey: "owner/products/front.png",
          originalName: "front.png",
          mimeType: "image/png",
          kind: "product",
        }),
        asset({
          id: "image-2",
          storageKey: "owner/products/back.webp",
          originalName: "back.webp",
          mimeType: "image/webp",
          kind: "product",
        }),
      ],
      tosConfigured: true,
      download: async (storageKey, filePath) => {
        downloads.push(storageKey);
        await Bun.write(filePath, storageKey);
      },
    });

    expect(downloads).toEqual(["owner/materials/video.mp4", "owner/products/front.png", "owner/products/back.webp"]);
    expect(result.videoPath).toBe(resolve(paths.tempDir, "source.mp4"));
    expect(result.referencePaths).toEqual([
      resolve(paths.tempDir, "product-1.png"),
      resolve(paths.tempDir, "product-2.webp"),
    ]);
    expect(await Bun.file(result.videoPath).text()).toBe("owner/materials/video.mp4");
  });

  test("prefers safe local files without downloading from TOS", async () => {
    const paths = await directories();
    const videoStorageKey = "owner/materials/local.mp4";
    const imageStorageKey = "owner/products/local.jpg";
    await Promise.all([
      mkdir(dirname(resolve(paths.uploadRoot, videoStorageKey)), { recursive: true }),
      mkdir(dirname(resolve(paths.uploadRoot, imageStorageKey)), { recursive: true }),
    ]);
    await Promise.all([
      Bun.write(resolve(paths.uploadRoot, videoStorageKey), "video"),
      Bun.write(resolve(paths.uploadRoot, imageStorageKey), "image"),
    ]);

    const result = await materializeRemixAnalysisAssets({
      ...paths,
      videoAsset: asset({
        id: "video-1",
        storageKey: videoStorageKey,
        originalName: "local.mp4",
        mimeType: "video/mp4",
        kind: "media",
      }),
      referenceAssets: [
        asset({
          id: "image-1",
          storageKey: imageStorageKey,
          originalName: "local.jpg",
          mimeType: "image/jpeg",
          kind: "product",
        }),
      ],
      tosConfigured: false,
      download: () => Promise.reject(new Error("download must not run")),
    });

    expect(result.videoPath).toBe(resolve(paths.uploadRoot, videoStorageKey));
    expect(result.referencePaths).toEqual([resolve(paths.uploadRoot, imageStorageKey)]);
  });

  test("fails clearly when a remote video has no available TOS backend", async () => {
    const paths = await directories();
    const pending = materializeRemixAnalysisAssets({
      ...paths,
      videoAsset: asset({
        id: "video-1",
        storageKey: "owner/materials/missing.mp4",
        originalName: "missing.mp4",
        mimeType: "video/mp4",
        kind: "media",
      }),
      referenceAssets: [],
      tosConfigured: false,
      download: () => Promise.reject(new Error("download must not run")),
    });

    await expect(pending).rejects.toThrow("视频素材不在本机且 TOS 未配置");
  });
});
