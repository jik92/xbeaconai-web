import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("compact admin page", () => {
  test("uses shared tables and shadcn controls for credential and queue actions", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../web/features/admin/admin-page.tsx")).text();

    expect(source).toContain("检测全部");
    expect(source).toContain("用户管理");
    expect(source).toContain("充值创作点");
    expect(source).toContain("setAdminUserStatus");
    expect(source).toContain("grantCreditsToAdminUser");
    expect(source).toContain("停止所有任务");
    expect(source).toContain("saveCredential(row.original)");
    expect(source).toContain("getRowId={(credential) => credential.name}");
    expect(source).toContain('from "@/components/ui/button"');
    expect(source).toContain('from "@/components/ui/input"');
    expect(source).toContain('from "@/components/ui/native-select"');
    expect(source).toContain('from "@/components/ui/data-table"');
    expect(source).not.toContain("groups.map");
    expect(source).not.toContain("admin-page.css");
  });
});
