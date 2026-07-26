import { describe, expect, test } from "bun:test";
import { sceneCatalog } from "../../shared/scenes/scene-catalog";

describe("scene catalog", () => {
  test("contains 47 unique scenes with locally imported images", async () => {
    expect(sceneCatalog).toHaveLength(47);
    expect(new Set(sceneCatalog.map((scene) => scene.id)).size).toBe(47);
    expect(new Set(sceneCatalog.map((scene) => scene.imageUrl)).size).toBe(47);

    const files = sceneCatalog.map((scene) => Bun.file(`public${scene.imageUrl}`));
    expect((await Promise.all(files.map((file) => file.exists()))).every(Boolean)).toBe(true);
    expect(files.every((file) => file.type === "image/jpeg")).toBe(true);
  });

  test("keeps every scene searchable by a product category", () => {
    expect(new Set(sceneCatalog.map((scene) => scene.category))).toEqual(
      new Set(["纯色背景", "产品展台", "自然户外", "办公空间", "酒店空间", "运动健康", "商业空间", "居家空间"]),
    );
    expect(sceneCatalog.every((scene) => scene.name && scene.description && scene.sourceUrl)).toBe(true);
  });
});
