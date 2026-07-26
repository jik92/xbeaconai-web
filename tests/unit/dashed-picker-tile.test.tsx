import { describe, expect, test } from "bun:test";
import { Plus } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashedPickerTile } from "../../web/components/domain/dashed-picker-tile";

describe("DashedPickerTile", () => {
  test("renders the shared compact dashed resource trigger", () => {
    const html = renderToStaticMarkup(<DashedPickerTile title="添加" icon={<Plus />} aria-label="添加产品图片" />);

    expect(html).toContain("dashed-picker-tile");
    expect(html).toContain("border-dashed");
    expect(html).toContain("h-20 w-16");
    expect(html).toContain('aria-label="添加产品图片"');
  });

  test("renders selected resource details in the wide presentation", () => {
    const html = renderToStaticMarkup(
      <DashedPickerTile
        presentation="wide"
        title="示例商品"
        description="3 张商品图"
        preview={<img src="/product.png" alt="示例商品" />}
      />,
    );

    expect(html).toContain("h-16 w-full");
    expect(html).toContain("示例商品");
    expect(html).toContain("3 张商品图");
    expect(html).toContain("/product.png");
  });
});
