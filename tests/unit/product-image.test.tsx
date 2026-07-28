import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductImage } from "../../web/components/domain/product-image";

describe("ProductImage", () => {
  test("renders the complete product image through the shared non-cropping contract", () => {
    const html = renderToStaticMarkup(
      <ProductImage
        url="https://files.xbeaconai.com/users/test/products/product.png"
        mimeType="image/png"
        alt="示例商品"
        authenticated={false}
      />,
    );

    expect(html).toContain("product-image");
    expect(html).toContain("size-full !object-contain");
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain("全屏预览");
  });

  test("shows an explicit placeholder when the product has no image", () => {
    const html = renderToStaticMarkup(<ProductImage url="" alt="无图商品" />);

    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="无图商品图片不可用"');
  });
});
