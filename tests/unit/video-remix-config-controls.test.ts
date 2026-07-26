import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx"), "utf8");
const styles = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.css"), "utf8");
const config = source.slice(source.indexOf("function ConfigSidebar"), source.indexOf("function AssetPicker"));

describe("video remix configuration controls", () => {
  test("maps the shared segmented control to the existing product and talking modes", () => {
    expect(config).toContain("<SegmentedControl");
    expect(config).toContain('ariaLabel="创作模式"');
    expect(config).toContain("options={remixModeOptions}");
    expect(config).toContain("onValueChange={setMode}");
    expect(source).toContain('{ value: "product", label: "含商品模式" }');
    expect(source).toContain('{ value: "talking", label: "纯口播模式" }');
    expect(config).not.toContain("<Switch");
    expect(config).not.toContain("remix-mode-tabs");
  });

  test("uses the shared dashed picker for product, portrait, and voice dialogs", () => {
    expect(config.match(/<DashedPickerTile/g)).toHaveLength(3);
    expect(config).toContain('onClick={() => onPick("product")}');
    expect(config).toContain('onClick={() => onPick("portrait")}');
    expect(config).toContain('onClick={() => onPick("voice")}');
    expect(styles).not.toContain(".config-product");
    expect(styles).not.toContain(".config-voice");
    expect(styles).not.toContain(".remix-mode-tabs");
  });

  test("reuses the shared portrait picker while preserving the three-person limit", () => {
    expect(source).toContain('from "@/features/portrait-library/portrait-picker-dialog"');
    expect(source).toContain("<PortraitPickerDialog");
    expect(source).toContain("maxSelect={3}");
    expect(source).toContain("portraits.map(toSelectedPortrait)");
    expect(source).not.toContain("function PortraitPickerModal");
    expect(styles).not.toContain(".portrait-picker-modal");
    expect(styles).not.toContain(".portrait-picker-grid");
    expect(styles).not.toContain(".portrait-picker-footer");
  });

  test("keeps shared button variants authoritative across the remix page", () => {
    const buttonTags = source.match(/<Button\b[\s\S]*?>/g) ?? [];
    const pickerFooterRule = styles.match(/\.remix-picker > footer button \{([^}]*)\}/)?.[1] ?? "";

    expect(buttonTags.length).toBeGreaterThan(0);
    for (const tag of buttonTags) expect(tag).toContain("variant=");
    expect(styles).not.toContain('button:not(.remix-header-action):not([aria-label^="关闭"])');
    expect(pickerFooterRule).not.toContain("background:");
    expect(pickerFooterRule).not.toContain("text-on-primary");
  });
});
