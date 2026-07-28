import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("video remix product action", () => {
  test("uses one shared dashed trigger without a duplicate product action", () => {
    const source = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx"), "utf8");

    expect(source).toContain("<DashedPickerTile");
    expect(source).toContain('aria-label={selectedProduct ? "更换商品" : "选择商品"}');
    expect(source).not.toContain("⚙ 商品库");
    expect(source).not.toContain('className="config-product"');
  });

  test("shows complete product images only inside the product picker", () => {
    const styles = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.css"), "utf8");

    expect(styles).toMatch(
      /\.product-picker-grid > button > span\.product img \{\s*padding: 8px;\s*object-fit: contain;\s*\}/,
    );
    expect(styles).toMatch(/\.remix-picker-grid > button > span img \{[\s\S]*?object-fit: cover;/);
  });
});
