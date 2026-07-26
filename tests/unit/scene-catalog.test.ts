import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
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

  test("matches all six original tags for every source scene", () => {
    const canonical = sceneCatalog.map((scene) => [
      scene.id,
      scene.name,
      scene.description,
      scene.sourceUrl,
      [
        scene.spaceType,
        scene.sceneAttribute,
        scene.sceneType,
        scene.style,
        scene.lighting,
        scene.applicableCategories.join("、"),
      ],
    ]);

    expect(canonical.every(([, , , , tags]) => Array.isArray(tags) && tags.length === 6)).toBe(true);
    expect(createHash("sha256").update(JSON.stringify(canonical)).digest("hex")).toBe(
      "bb93c7f9d9ad6a33b33306bcacb119ff6120b6ae6423b9f77b0ae2d2cde9e419",
    );
    expect(new Set(sceneCatalog.map((scene) => scene.spaceType))).toEqual(new Set(["虚拟", "室外", "室内"]));
    expect(new Set(sceneCatalog.map((scene) => scene.sceneAttribute))).toEqual(
      new Set(["专业", "自然", "商业", "居家"]),
    );
    expect(new Set(sceneCatalog.map((scene) => scene.sceneType)).size).toBe(27);
    expect(new Set(sceneCatalog.map((scene) => scene.style)).size).toBe(16);
    expect(new Set(sceneCatalog.map((scene) => scene.lighting)).size).toBe(5);
    expect(sceneCatalog.every((scene) => scene.name && scene.description && scene.sourceUrl)).toBe(true);
  });
});
