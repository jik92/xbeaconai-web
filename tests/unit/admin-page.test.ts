import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("compact admin page", () => {
  test("uses shared tables and shadcn controls for credential and queue actions", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../web/features/admin/admin-page.tsx")).text();

    expect(source).toContain("检测全部");
    expect(source).toContain("导入密钥文件");
    expect(source).toContain('aria-label="选择密钥文件"');
    expect(source).not.toContain('accept=".env.key"');
    expect(source).toContain("导出 .env.key");
    expect(source).toContain("fetchAdminEnvKeyExport");
    expect(source).toContain("用户管理");
    expect(source).toContain("充值创作点");
    expect(source).toContain("setAdminUserStatus");
    expect(source).toContain("grantCreditsToAdminUser");
    expect(source).toContain("releaseSelectedAdminUsers");
    expect(source).toContain("释放账号");
    expect(source).toContain('releaseConfirmation !== "释放账号"');
    expect(source).toContain("SelectionCheckbox");
    expect(source).toContain('member.status === "disabled" && !member.isAdmin');
    expect(source).toContain("此操作不可恢复");
    expect(source).toContain("停止所有任务");
    expect(source).toContain("saveCredential(row.original)");
    expect(source).toContain("getRowId={(credential) => credential.name}");
    expect(source).toContain("href={row.original.docsUrl}");
    expect(source).toContain('target="_blank"');
    expect(source).toContain('rel="noopener noreferrer"');
    expect(source).toContain("<ExternalLink");
    expect(source).toContain('from "@/components/ui/button"');
    expect(source).toContain('from "@/components/ui/input"');
    expect(source).toContain('from "@/components/ui/native-select"');
    expect(source).toContain('from "@/components/ui/data-table"');
    expect(source).not.toContain("groups.map");
    expect(source).not.toContain("admin-page.css");
  });
});
