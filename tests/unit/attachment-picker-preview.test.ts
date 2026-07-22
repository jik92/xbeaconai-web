import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const pickerPath = resolve(import.meta.dir, "../../web/components/domain/attachment-picker.tsx");
const stylesPath = resolve(import.meta.dir, "../../web/styles/globals.css");

describe("attachment picker preview", () => {
  test("opens preview only from a file click and lets users close it independently", async () => {
    const source = await Bun.file(pickerPath).text();

    expect(source).toContain("{previewAsset && (");
    expect(source).toContain("setPreviewId(asset.id);");
    expect(source).toContain('aria-label="关闭文件预览"');
    expect(source).toContain('onClick={() => setPreviewId("")}');
    expect(source).not.toContain("onMouseEnter={() => setPreviewId");
    expect(source).not.toContain("onFocus={() => setPreviewId");
    expect(source).not.toContain("data.find((asset) => asset.id === selected.at(-1))");
  });

  test("uses two columns by default and adds an on-demand preview column", async () => {
    const styles = await Bun.file(stylesPath).text();

    expect(styles).toContain("grid-template-columns: 190px minmax(0, 1fr);");
    expect(styles).toContain("grid-template-columns: 190px minmax(0, 1fr) 280px;");
    expect(styles).toContain(".attachment-picker-dialog.has-preview");
    expect(styles).toContain(".attachment-directory-layout.has-preview");
  });
});
