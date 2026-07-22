import { describe, expect, test } from "bun:test";
import {
  isSidebarMenuItemHidden,
  moveSidebarMenuItem,
  normalizeSidebarMenuPreferences,
  reorderSidebarMenuItem,
  setSidebarMenuItemVisibility,
} from "../../web/components/domain/sidebar-menu-preferences";

const defaults = {
  workflow: ["remix", "create", "script"],
  assets: ["materials", "portraits"],
};

describe("sidebar menu preferences", () => {
  test("keeps a saved order and appends newly introduced menu items", () => {
    expect(
      normalizeSidebarMenuPreferences(
        {
          order: { workflow: ["create", "remix", "removed"], assets: ["portraits"] },
          hidden: ["script", "removed"],
        },
        defaults,
      ),
    ).toEqual({
      order: { workflow: ["create", "remix", "script"], assets: ["portraits", "materials"] },
      hidden: ["script"],
      shown: [],
    });
  });

  test("supports drag-style and keyboard-friendly item movement", () => {
    const initial = normalizeSidebarMenuPreferences(undefined, defaults);
    const dragged = reorderSidebarMenuItem(initial, "workflow", "script", "remix");
    expect(dragged.order.workflow).toEqual(["script", "remix", "create"]);
    expect(moveSidebarMenuItem(dragged, "workflow", "remix", 1).order.workflow).toEqual(["script", "create", "remix"]);
  });

  test("hides unavailable items by default and records an explicit show override", () => {
    const initial = normalizeSidebarMenuPreferences(undefined, defaults);
    expect(isSidebarMenuItemHidden(initial, "create", false)).toBe(true);
    expect(isSidebarMenuItemHidden(initial, "create", true)).toBe(false);

    const shown = setSidebarMenuItemVisibility(initial, "create", true);
    expect(shown).toMatchObject({ hidden: [], shown: ["create"] });
    expect(isSidebarMenuItemHidden(shown, "create", false)).toBe(false);

    const hidden = setSidebarMenuItemVisibility(shown, "create", false);
    expect(hidden).toMatchObject({ hidden: ["create"], shown: [] });
    expect(hidden.order).toEqual(initial.order);
    expect(isSidebarMenuItemHidden(hidden, "create", true)).toBe(true);
  });

  test("normalizes explicit shown values and lets hidden win malformed conflicts", () => {
    expect(
      normalizeSidebarMenuPreferences(
        {
          order: defaults,
          hidden: ["script"],
          shown: ["create", "script", "removed", "create"],
        },
        defaults,
      ),
    ).toMatchObject({ hidden: ["script"], shown: ["create"] });
  });
});
