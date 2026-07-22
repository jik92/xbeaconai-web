import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("video remix product action", () => {
  test("keeps the product library entry without a duplicate change label", () => {
    const source = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx"), "utf8");

    expect(source).toContain('<button onClick={() => onPick("product")}>⚙ 商品库</button>');
    expect(source).toContain('<button className="config-product" onClick={() => onPick("product")}>');
    expect(source).not.toContain('<b>{selectedProduct ? "更换" : "选择"}</b>');
  });
});
