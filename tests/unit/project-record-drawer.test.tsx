import { afterEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const window = new Window();
const roots: Root[] = [];

Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLSelectElement: window.HTMLSelectElement,
  Event: window.Event,
  InputEvent: window.InputEvent,
  MouseEvent: window.MouseEvent,
  CustomEvent: window.CustomEvent,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  MutationObserver: window.MutationObserver,
  getComputedStyle: window.getComputedStyle.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { ProjectRecordDrawer } = await import("../../web/components/domain/project-record-drawer");
const { fireEvent } = await import("@testing-library/react");
const { default: userEvent } = await import("@testing-library/user-event");

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

async function renderDrawer() {
  const fetchPage = mock(async (_input: { query?: string; status?: string; page: number; pageSize: number }) => ({
    items: [
      {
        id: "project-1",
        title: "示例项目",
        status: "draft",
        statusLabel: "草稿",
        summary: "示例商品",
        updatedAt: "2026-07-27T08:00:00.000Z",
        revision: 3,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  }));
  const onRename = mock(async (_item: { id: string }, _title: string) => undefined);
  const onContinue = mock(async (_item: { id: string }) => undefined);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ProjectRecordDrawer
          open
          queryKey="test-project-records"
          currentProjectId="project-1"
          statusOptions={[{ value: "draft", label: "草稿" }]}
          fetchPage={fetchPage}
          onClose={() => undefined}
          onRename={onRename}
          onContinue={onContinue}
        />
      </QueryClientProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return { fetchPage, onRename, onContinue };
}

describe("ProjectRecordDrawer", () => {
  test("renders one shared compact record layout and continues the current project", async () => {
    const { onContinue } = await renderDrawer();

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("生成记录");
    expect(document.body.textContent).toContain("示例项目");
    expect(document.body.textContent).toContain("当前项目");
    expect(document.body.textContent).toContain("已加载 1/1 条");

    const continueButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "继续创作",
    );
    await act(async () => {
      continueButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ id: "project-1", revision: 3 }));
  });

  test("applies status filtering and submits an inline rename", async () => {
    const { fetchPage, onRename } = await renderDrawer();
    const select = document.querySelector('select[aria-label="项目状态"]') as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set?.call(select, "draft");
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(fetchPage).toHaveBeenLastCalledWith(expect.objectContaining({ status: "draft", page: 1, pageSize: 20 }));

    const renameButton = document.querySelector('button[aria-label="重命名 示例项目"]');
    expect(renameButton).not.toBeNull();
    act(() => renameButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const input = document.querySelector('input[aria-label="重命名 示例项目"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    const user = userEvent.setup({ document });
    await act(async () => {
      await user.clear(input);
      await user.type(input, "紧凑生成记录");
    });
    expect(input.value).toBe("紧凑生成记录");
    const saveButton = document.querySelector('button[aria-label="保存 示例项目"]');
    expect(saveButton).not.toBeNull();
    await act(async () => {
      if (saveButton) fireEvent.click(saveButton);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: "project-1" }), "紧凑生成记录");
  });
});
