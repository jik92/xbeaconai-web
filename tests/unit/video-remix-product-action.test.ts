import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx"), "utf8");

describe("video remix product action", () => {
  test("uses one shared dashed trigger without a duplicate product action", () => {
    expect(source).toContain("<DashedPickerTile");
    expect(source).toContain('aria-label={selectedProduct ? "更换商品" : "选择商品"}');
    expect(source).not.toContain("⚙ 商品库");
    expect(source).not.toContain('className="config-product"');
  });

  test("uses the shared complete product image without clipping the picker card", () => {
    expect(source).toContain('import { ProductImage } from "@/components/domain/product-image";');
    expect(source.match(/<ProductImage/g)).toHaveLength(2);
    expect(source).toMatch(
      /className=\{`h-auto min-h-0 w-full flex-col items-stretch justify-start gap-0 whitespace-normal \$\{isSelected \? "selected" : ""\}`\}/,
    );
  });
});
