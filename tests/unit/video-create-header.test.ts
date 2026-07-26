import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const page = await Bun.file(resolve(import.meta.dir, "../../web/features/video-create/video-create-page.tsx")).text();
const header = page.slice(
  page.indexOf("function VideoCreateWorkflowHeader"),
  page.indexOf("function videoCreateStatusTone"),
);

describe("one-click video workflow header", () => {
  test("uses the shared compact non-interactive workflow structure with a subtle shadow", () => {
    expect(page).toContain('const videoCreateWorkflowStages = ["项目配置", "脚本生成", "分镜制作", "合并成片"]');
    expect(header).toContain('aria-label="一键成片创作进度"');
    expect(header).toContain('aria-current={index === stage ? "step" : undefined}');
    expect(header).toContain("shadow-sm");
    expect(header).toContain("一键成片");
    expect(header).not.toContain("onStage");
    expect(page.match(/<VideoCreateWorkflowHeader\b/g)).toHaveLength(1);
    expect(page).not.toContain('type-page-title text-ink">新建项目');
  });

  test("maps real project states and preserves every header action", () => {
    expect(page).toContain('["analyzing", "script_generating", "script_review"]');
    expect(page).toContain('["storyboard_generating", "storyboard_review"]');
    expect(page).toContain('["composing", "completed"]');
    for (const label of ["一键生成", "保存草稿", "生成记录", "新建一键成片项目"])
      expect(page).toContain(`aria-label="${label}"`);
    expect(page).toContain('variant="outline"');
    expect(page).toContain('variant="ghost"');
  });
});
