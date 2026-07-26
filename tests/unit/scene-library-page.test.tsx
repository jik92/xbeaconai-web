import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SceneLibrary } from "../../web/features/scene-library/scene-library";

describe("scene library page", () => {
  test("renders every source scene and the original filter dimensions", () => {
    const html = renderToStaticMarkup(<SceneLibrary />);

    expect(html.match(/class="[^"]*\bgroup\b[^"]*\bself-start\b[^"]*\boverflow-hidden\b/g) ?? []).toHaveLength(47);
    expect(html).toContain("搜索场景名称、描述或 Tag");
    expect(html).toContain('aria-label="空间类型"');
    expect(html).toContain('aria-label="场景属性"');
    expect(html.match(/object-contain/g) ?? []).toHaveLength(47);
    expect(html.match(/block h-auto w-full object-contain/g) ?? []).toHaveLength(47);
    expect(html).not.toContain("object-cover");
    expect(html).not.toContain("aspect-[4/5]");
    expect(html).toContain("auto-rows-max");
    expect(html).toContain("md:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12");
    for (const value of ["虚拟", "室外", "室内", "专业", "自然", "商业", "居家"])
      expect(html).toContain(`>${value}</option>`);
    expect(html).toContain("共 47 项");
  });
});
