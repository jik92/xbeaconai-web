import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("notification center styling", () => {
  test("uses compact ghost buttons with Tailwind multi-line layout instead of legacy CSS", async () => {
    const [component, css] = await Promise.all([
      Bun.file(resolve(import.meta.dir, "../../web/features/account/workspace-panels.tsx")).text(),
      Bun.file(resolve(import.meta.dir, "../../web/styles/account.css")).text(),
    ]);

    expect(component).toContain('variant="ghost"');
    expect(component).toContain(
      "h-auto w-full items-start justify-start rounded-none px-2 py-3 text-left whitespace-normal",
    );
    expect(component).toContain("divide-y divide-line");
    expect(css).not.toContain(".notification-list");
    expect(css).not.toContain(".panel-toolbar");
  });
});
