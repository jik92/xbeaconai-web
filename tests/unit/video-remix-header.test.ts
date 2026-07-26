import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx"), "utf8");
const styles = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.css"), "utf8");
const header = page.slice(page.indexOf("function WorkflowHeader"), page.indexOf("function ConfigSidebar"));
const progress = header.slice(header.indexOf('<ol className="remix-steps"'), header.indexOf("</ol>") + 5);

describe("video remix workflow header", () => {
  test("renders the workflow as a non-interactive semantic progress list", () => {
    expect(progress).toContain('<ol className="remix-steps" aria-label="创作进度">');
    expect(progress).toContain("<li");
    expect(progress).toContain('aria-current={index === stage ? "step" : undefined}');
    expect(progress).not.toContain("<Button");
    expect(header).not.toContain("onStage");
    expect(styles).toContain(".remix-steps li {");
    expect(styles).not.toContain(".remix-steps button");
  });

  test("matches the shared compact header action hierarchy", () => {
    expect(header).toContain(
      '<Button className="remix-header-action shrink-0" variant="outline" size="sm" onClick={onHistory}>',
    );
    expect(header).toContain(
      '<Button className="remix-header-action shrink-0" variant="ghost" size="sm" onClick={onReset}>',
    );
    expect(styles).toContain('.remix-project button:not(.remix-header-action):not([aria-label^="关闭"])');
    expect(styles).toContain(".remix-header-actions {");
    expect(styles).toContain("gap: 8px;");
    expect(styles).not.toContain(".remix-header-actions button");
  });
});
