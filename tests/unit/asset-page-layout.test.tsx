import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AssetPageShell, AssetPageToolbar } from "../../web/components/domain/asset-page-shell";

describe("shared asset page layout", () => {
  test("renders the compact toolbar, content, and count on a white page", () => {
    const html = renderToStaticMarkup(
      <AssetPageShell
        count={12}
        toolbar={
          <AssetPageToolbar
            query=""
            onQueryChange={() => undefined}
            placeholder="搜索素材名称或描述"
            actionLabel="上传素材"
            onAction={() => undefined}
          />
        }
      >
        <div>素材内容</div>
      </AssetPageShell>,
    );

    expect(html).toContain("bg-white p-3");
    expect(html).toContain("h-[calc(100vh-56px)]");
    expect(html).toContain("搜索素材名称或描述");
    expect(html).toContain("上传素材");
    expect(html).toContain("素材内容");
    expect(html).toContain("共 12 项");
  });

  test("keeps the material library sidebar as a separate first column", () => {
    const html = renderToStaticMarkup(
      <AssetPageShell count={0} sidebar={<aside>文件夹</aside>} toolbar={<div>搜索栏</div>}>
        <div>素材表格</div>
      </AssetPageShell>,
    );

    expect(html.indexOf("文件夹")).toBeLessThan(html.indexOf("搜索栏"));
    expect(html).toContain("w-56");
    expect(html).toContain("border-r border-line");
    expect(html).toContain("素材表格");
  });
});
