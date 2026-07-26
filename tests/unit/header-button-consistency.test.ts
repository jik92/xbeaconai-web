import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dir, "../..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("compact header button consistency", () => {
  test("uses one semantic action hierarchy across video creation headers", () => {
    const create = source("web/features/video-create/video-create-page.tsx");
    const remix = source("web/features/video-remix/remix-project.tsx");
    const remixStyles = source("web/features/video-remix/remix-project.css");

    expect(create).toContain('variant="outline"\n              size="sm"\n              aria-label="生成记录"');
    expect(create).toContain('variant="ghost"\n              size="sm"\n              aria-label="新建一键成片项目"');
    expect(remix).toContain(
      '<Button className="remix-header-action shrink-0" variant="outline" size="sm" onClick={onHistory}>',
    );
    expect(remix).toContain(
      '<Button className="remix-header-action shrink-0" variant="ghost" size="sm" onClick={onReset}>',
    );
    expect(remixStyles).not.toContain(".remix-header-actions button");
  });

  test("removes legacy page-specific header button sizing", () => {
    const editor = source("web/features/video-editor/video-editor-page.tsx");
    const editorHeader = editor.slice(editor.indexOf('className="video-editor-topbar"'), editor.indexOf("</header>"));
    const globalStyles = source("web/styles/globals.css");
    const merchant = source("web/features/qianchuan/qianchuan-merchant-binding-page.tsx");
    const delivery = source("web/features/qianchuan/qianchuan-pc-delivery-page.tsx");

    expect(editorHeader).toContain('variant="outline" size="sm"');
    expect(editorHeader).toContain('type="button"\n            size="sm"');
    expect(editorHeader).not.toContain("primary-action");
    expect(globalStyles).not.toContain(".video-editor-topbar button");
    expect(globalStyles).not.toContain(".video-editor-topbar .primary-action");
    expect(merchant).toContain('<Button size="sm" disabled={!config.data?.configured || oauth.isPending}');
    expect(delivery).toContain('<Button variant="outline" size="sm" onClick={refresh}>');
  });

  test("uses ghost icon buttons for every Header close action", async () => {
    const violations: string[] = [];
    const files = new Bun.Glob("web/**/*.tsx").scan({ cwd: root });

    for await (const file of files) {
      const text = source(file);
      const syntax = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node, insideHeader = false) => {
        const isElement = ts.isJsxElement(node);
        const tag = isElement ? node.openingElement.tagName.getText(syntax) : undefined;
        const nextInsideHeader = insideHeader || tag === "header";

        if (isElement && tag === "Button" && insideHeader && node.getText(syntax).includes("<X")) {
          const opening = node.openingElement.getText(syntax);
          const line = syntax.getLineAndCharacterOfPosition(node.getStart(syntax)).line + 1;
          if (!opening.includes('variant="ghost"') || !opening.includes('size="icon-sm"')) {
            violations.push(`${file}:${line}`);
          }
        }

        ts.forEachChild(node, (child) => visit(child, nextInsideHeader));
      };

      visit(syntax);
    }

    expect(violations).toEqual([]);
  });

  test("does not retain visual CSS overrides for standardized Header close buttons", () => {
    const styles = [
      source("web/styles/globals.css"),
      source("web/styles/account.css"),
      source("web/features/ai-creation/ai-creation-composer.css"),
      source("web/features/media-understand/media-understand-page.css"),
    ].join("\n");
    const forbidden = [
      ".utility-dialog header button",
      ".attachment-picker-dialog > header button",
      ".attachment-preview-panel > header > button",
      ".result-drawer header button",
      ".workspace-drawer header > button",
      ".composer-review-backdrop header button",
      ".mu-result-mask header button",
    ];

    expect(forbidden.filter((selector) => styles.includes(selector))).toEqual([]);
  });
});
