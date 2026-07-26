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
  MouseEvent: window.MouseEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { SegmentedControl } = await import("../../web/components/ui/segmented-control");

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

describe("SegmentedControl", () => {
  test("renders the shared visual state and reports the selected value", () => {
    const onValueChange = mock((_value: "product" | "talking") => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);

    act(() => {
      root.render(
        <SegmentedControl
          ariaLabel="创作模式"
          value="product"
          options={[
            { value: "product", label: "含商品模式" },
            { value: "talking", label: "纯口播模式" },
          ]}
          onValueChange={onValueChange}
          fullWidth
        />,
      );
    });

    const group = document.querySelector('[role="group"][aria-label="创作模式"]');
    const buttons = Array.from(group?.querySelectorAll("button") ?? []);
    expect(group?.className).toContain("bg-surface-muted");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(buttons[0]?.className).toContain("bg-surface shadow-sm");

    act(() => buttons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onValueChange).toHaveBeenCalledWith("talking");
  });
});
