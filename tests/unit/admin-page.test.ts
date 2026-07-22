import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("compact admin page", () => {
  test("uses shared shadcn controls for Doctor, Provider save and stop-all actions", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../web/features/admin/admin-page.tsx")).text();

    expect(source).toContain("检测全部");
    expect(source).toContain("停止所有任务");
    expect(source).toContain("saveGroup(provider, credentials)");
    expect(source).toContain('from "@/components/ui/button"');
    expect(source).toContain('from "@/components/ui/input"');
    expect(source).toContain('from "@/components/ui/native-select"');
    expect(source).toContain('from "@/components/ui/data-table"');
    expect(source).not.toContain("admin-page.css");
  });
});
