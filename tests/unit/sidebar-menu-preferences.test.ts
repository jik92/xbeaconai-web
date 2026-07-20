import { describe, expect, test } from "bun:test";
import {
  moveSidebarMenuItem,
  normalizeSidebarMenuPreferences,
  reorderSidebarMenuItem,
  toggleSidebarMenuItem,
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
    });
  });

  test("supports drag-style and keyboard-friendly item movement", () => {
    const initial = normalizeSidebarMenuPreferences(undefined, defaults);
    const dragged = reorderSidebarMenuItem(initial, "workflow", "script", "remix");
    expect(dragged.order.workflow).toEqual(["script", "remix", "create"]);
    expect(moveSidebarMenuItem(dragged, "workflow", "remix", 1).order.workflow).toEqual(["script", "create", "remix"]);
  });

  test("toggles item visibility without changing its position", () => {
    const initial = normalizeSidebarMenuPreferences(undefined, defaults);
    const hidden = toggleSidebarMenuItem(initial, "create");
    expect(hidden.hidden).toEqual(["create"]);
    expect(toggleSidebarMenuItem(hidden, "create")).toEqual(initial);
  });
});
