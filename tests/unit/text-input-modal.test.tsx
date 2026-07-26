import { afterEach, describe, expect, mock, test } from "bun:test";
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

const { TextInputModal } = await import("../../web/components/ui/text-input-modal");

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

async function renderModal(onSubmit: (value: string) => void | Promise<void>, initialValue = "") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const onOpenChange = mock((_open: boolean) => undefined);

  await act(async () => {
    root.render(
      <TextInputModal
        open
        title="新建文件夹"
        label="文件夹名称"
        initialValue={initialValue}
        placeholder="输入文件夹名称"
        confirmLabel="创建"
        requiredMessage="请输入文件夹名称"
        onOpenChange={onOpenChange}
        onSubmit={onSubmit}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  return { onOpenChange };
}

function button(label: string) {
  return Array.from(document.querySelectorAll("button")).find((item) => item.textContent === label);
}

describe("TextInputModal", () => {
  test("trims and submits a valid value before requesting close", async () => {
    const onSubmit = mock(async (_value: string) => undefined);
    const { onOpenChange } = await renderModal(onSubmit, "  今日成片  ");
    await act(async () => {
      button("创建")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onSubmit).toHaveBeenCalledWith("今日成片");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test("shows required validation without submitting", async () => {
    const onSubmit = mock(async (_value: string) => undefined);
    await renderModal(onSubmit);

    await act(async () => {
      button("创建")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("请输入文件夹名称");
  });

  test("keeps an async submission error in the modal", async () => {
    const onSubmit = mock(async () => {
      throw new Error("同级目录下已存在同名文件夹");
    });
    const { onOpenChange } = await renderModal(onSubmit, "重复名称");
    const input = document.querySelector('input[placeholder="输入文件夹名称"]') as HTMLInputElement;
    await act(async () => {
      button("创建")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.querySelector('[role="alert"]')?.textContent).toBe("同级目录下已存在同名文件夹");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(input.value).toBe("重复名称");
  });
});
