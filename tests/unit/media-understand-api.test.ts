import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { resolveMediaUnderstandAssets } from "../../server/media-understand/job-service";

const ownerId = crypto.randomUUID();
const otherOwnerId = crypto.randomUUID();
const primaryId = crypto.randomUUID();
const imageId = crypto.randomUUID();

const assets = new Map([
  [
    `${ownerId}:${primaryId}`,
    {
      id: primaryId,
      ownerUserId: ownerId,
      storageKey: `${ownerId}/media/source.mp4`,
      originalName: "source.mp4",
      mimeType: "video/mp4",
      byteSize: 1024,
      kind: "media" as const,
      displayName: "原视频",
      createdAt: new Date().toISOString(),
    },
  ],
  [
    `${ownerId}:${imageId}`,
    {
      id: imageId,
      ownerUserId: ownerId,
      storageKey: `${ownerId}/products/cup.png`,
      originalName: "cup.png",
      mimeType: "image/png",
      byteSize: 1024,
      kind: "product" as const,
      displayName: "玻璃大茶缸",
      createdAt: new Date().toISOString(),
    },
  ],
]);

describe("media understanding API asset boundary", () => {
  test("resolves only an owned primary media plus owned image references", () => {
    const result = resolveMediaUnderstandAssets(
      ownerId,
      { primaryAssetId: primaryId, referenceImageAssetIds: [imageId] },
      (userId, assetId) => assets.get(`${userId}:${assetId}`),
    );
    expect(result.primary.mimeType).toBe("video/mp4");
    expect(result.references.map((item) => item.mimeType)).toEqual(["image/png"]);
  });

  test("does not resolve an otherwise valid asset for another owner", () => {
    expect(() =>
      resolveMediaUnderstandAssets(
        otherOwnerId,
        { primaryAssetId: primaryId, referenceImageAssetIds: [] },
        (userId, assetId) => assets.get(`${userId}:${assetId}`),
      ),
    ).toThrow("主素材不存在或不属于当前账号");
  });

  test("rejects unsupported primary files and non-image references", () => {
    expect(() =>
      resolveMediaUnderstandAssets(
        ownerId,
        { primaryAssetId: imageId, referenceImageAssetIds: [primaryId] },
        (userId, assetId) => assets.get(`${userId}:${assetId}`),
      ),
    ).toThrow("商品参考素材必须是图片");
  });

  test("runs the authenticated dedicated API against an isolated database", async () => {
    const dataDir = mkdtempSync(resolve(tmpdir(), "yaozuo-media-understand-api-runner-"));
    try {
      const child = Bun.spawn(["bun", "test", "./tests/integration/media-understand-api-isolated.test.ts"], {
        cwd: resolve(import.meta.dir, "../.."),
        env: {
          ...process.env,
          YAOZUO_DATA_DIR: dataDir,
          BYOK_ENCRYPTION_KEY: "media-understand-api-test-key-32-characters",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 30_000);
});
