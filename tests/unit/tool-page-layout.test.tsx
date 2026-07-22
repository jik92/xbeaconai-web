import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolCreatorModal } from "../../web/components/domain/tool-creator-modal";
import { createToolTaskLabel, ToolTaskPage } from "../../web/components/domain/tool-task-page";

describe("shared enabled tool layout", () => {
  test("builds the new task label from the current tool name", () => {
    expect(createToolTaskLabel("视频分割")).toBe("新建视频分割任务");
    expect(createToolTaskLabel("视频提取")).toBe("新建视频提取任务");
  });

  test("renders the compact search, primary action, task content, and count without a page card", () => {
    const newTaskLabel = createToolTaskLabel("视频分割");
    const html = renderToStaticMarkup(
      <ToolTaskPage actionLabel={newTaskLabel} onAction={() => undefined} onSearch={() => undefined} count={2}>
        <div>任务列表</div>
      </ToolTaskPage>,
    );

    expect(html).toContain("任务名称");
    expect(html).toContain("新建视频分割任务");
    expect(html).toContain("任务列表");
    expect(html).toContain("共 2 个任务");
    expect(html).toContain("bg-white p-3");
    expect(html).not.toContain("页面说明");
  });

  test("renders a title-only compact modal and omits closed modal content", () => {
    const openHtml = renderToStaticMarkup(
      <ToolCreatorModal open title="新建任务" onClose={() => undefined}>
        <div>表单内容</div>
      </ToolCreatorModal>,
    );
    const closedHtml = renderToStaticMarkup(
      <ToolCreatorModal open={false} title="新建任务" onClose={() => undefined}>
        <div>表单内容</div>
      </ToolCreatorModal>,
    );

    expect(openHtml).toContain('role="dialog"');
    expect(openHtml).toContain("max-w-lg");
    expect(openHtml).toContain("新建任务");
    expect(openHtml).toContain("表单内容");
    expect(closedHtml).toBe("");
  });
});
