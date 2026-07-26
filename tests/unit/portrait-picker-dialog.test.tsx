import { afterEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { GeneralPortrait, Portrait } from "../../web/features/portrait-library/portrait-data";

const window = new Window();
const roots: Root[] = [];

Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  MouseEvent: window.MouseEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { PortraitPickerDialog } = await import("../../web/features/portrait-library/portrait-picker-dialog");

const portraits: GeneralPortrait[] = Array.from({ length: 4 }, (_, offset) => {
  const index = offset + 1;
  return {
    index,
    key: `general:${index}`,
    type: "general",
    reference: { type: "general", portraitId: index },
    category: "通用",
    page: 1,
    name: `人像 ${index}`,
    description: `人像 ${index} 描述`,
    source_url: `/portrait-${index}.jpg`,
    display_url: `/portrait-${index}.jpg`,
    file: `portrait-${index}.jpg`,
    age: 20 + index,
    gender: index % 2 ? "女" : "男",
    profession: `职业 ${index}`,
    status: "active",
  };
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

function renderPicker({
  maxSelect,
  selectedKeys = [],
  onConfirm = mock((_portraits: Portrait[]) => undefined),
  onClose = mock(() => undefined),
}: {
  maxSelect: number;
  selectedKeys?: string[];
  onConfirm?: ReturnType<typeof mock<(portraits: Portrait[]) => void>>;
  onClose?: ReturnType<typeof mock<() => void>>;
}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      <PortraitPickerDialog
        open
        portraits={portraits}
        loading={false}
        selectedKeys={selectedKeys}
        maxSelect={maxSelect}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
  });
  return { container, onConfirm, onClose };
}

function portraitButtons(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));
}

function click(button?: HTMLButtonElement) {
  act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

describe("PortraitPickerDialog", () => {
  test("keeps single selection behavior for one-click video creation", () => {
    const { container, onConfirm } = renderPicker({ maxSelect: 1 });
    const cards = portraitButtons(container);

    click(cards[0]);
    click(cards[1]);
    expect(cards[0]?.getAttribute("aria-pressed")).toBe("false");
    expect(cards[1]?.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).not.toContain("最多 1 个");

    click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "确认选择"));
    expect(onConfirm).toHaveBeenCalledWith([portraits[1]]);
  });

  test("supports up to three reversible selections for video remix", () => {
    const { container, onConfirm } = renderPicker({ maxSelect: 3 });
    const cards = portraitButtons(container);

    click(cards[0]);
    click(cards[1]);
    click(cards[2]);
    click(cards[3]);
    expect(cards.slice(0, 3).every((card) => card.getAttribute("aria-pressed") === "true")).toBe(true);
    expect(cards[3]?.getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).toContain("已选择 3 个人像");

    click(cards[0]);
    click(cards[3]);
    click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "确认选择"));
    expect(onConfirm).toHaveBeenCalledWith([portraits[1], portraits[2], portraits[3]]);
  });

  test("does not commit pending changes when cancelled", () => {
    const onConfirm = mock((_portraits: Portrait[]) => undefined);
    const { container, onClose } = renderPicker({ maxSelect: 3, selectedKeys: [portraits[0].key], onConfirm });

    click(portraitButtons(container)[1]);
    click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "取消"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
