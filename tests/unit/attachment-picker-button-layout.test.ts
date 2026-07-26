import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(import.meta.dir, "../../web/components/domain/attachment-picker.tsx"), "utf8");
const styles = readFileSync(resolve(import.meta.dir, "../../web/styles/globals.css"), "utf8");

function rule(selector: string) {
  const start = styles.indexOf(`${selector} {`);
  if (start < 0) return "";
  return styles.slice(start, styles.indexOf("}", start) + 1);
}

describe("attachment picker button layout", () => {
  test("assigns shared semantic variants to navigation, cards, and footer actions", () => {
    expect(source.match(/variant="ghost"/g)?.length).toBeGreaterThanOrEqual(6);
    expect(source).toContain('<Button type="button" variant="outline" size="sm" onClick={close}>');
    expect(source).toContain(
      '<Button type="button" variant="default" size="sm" disabled={!selected.length} onClick={chooseLibrary}>',
    );
    expect(source).not.toContain('className="primary"');
  });

  test("keeps borders on structure instead of every nested button", () => {
    for (const selector of [
      ".attachment-source-tabs button",
      ".attachment-folder-tree nav button",
      ".attachment-breadcrumbs button",
      ".attachment-grid > button",
    ]) {
      expect(rule(selector)).not.toContain("border:");
      expect(rule(selector)).not.toContain("border-radius:");
    }
    expect(styles).not.toContain(".attachment-picker-dialog > footer button");
    expect(styles).not.toContain(".attachment-picker-dialog button:disabled");
    expect(rule(".attachment-directory-layout")).toContain("border: 1px solid var(--border);");
    expect(rule(".attachment-search")).toContain("border: 1px solid var(--border);");
  });
});
