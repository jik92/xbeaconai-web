import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("ad script entry", () => {
  test("always starts from the form without restoring an active project", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../web/features/ad-script/ad-script-page.tsx")).text();

    expect(source).toContain('useState<"form" | "progress" | "result">("form")');
    expect(source).toContain('const [projectId, setProjectId] = useState("")');
    expect(source).toContain("localStorage.removeItem(legacyActiveProjectKey)");
    expect(source).not.toContain("localStorage.getItem(activeProjectKey)");
    expect(source).not.toContain("localStorage.setItem(activeProjectKey");
  });

  test("uses shared UI components without exposing the underlying model", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../web/features/ad-script/ad-script-page.tsx")).text();

    expect(source).toContain('from "@/components/ui/button"');
    expect(source).toContain('from "@/components/ui/card"');
    expect(source).toContain('from "@/components/ui/input"');
    expect(source).toContain('from "@/components/ui/label"');
    expect(source).toContain('from "@/components/ui/native-select"');
    expect(source).toContain('from "@/components/ui/segmented-control"');
    expect(source).toContain('<SegmentedControl\n          ariaLabel="场景类型"');
    expect(source).toContain("options={sceneCategoryOptions}");
    expect(source).not.toContain('className="scene-tabs');
    expect(source).not.toMatch(/deepseek/i);
    expect(source).not.toContain('import "./ad-script-page.css"');
  });

  test("uses one shared five-stage workflow header across every screen", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../web/features/ad-script/ad-script-page.tsx")).text();

    expect(source).toContain(
      'const adScriptWorkflowStages = ["选择场景", "广告诉求", "脚本风格", "生成调优", "脚本结果"]',
    );
    expect(source).toContain('aria-label="口播脚本创作进度"');
    expect(source).toContain('aria-current={index === stage ? "step" : undefined}');
    expect(source).toContain('const workflowStage = screen === "form" ? step : screen === "progress" ? 3 : 4');
    expect(source.match(/<AdScriptWorkflowHeader\b/g)).toHaveLength(1);
    expect(source).toContain('<Button variant="outline" size="sm" aria-label="生成记录"');
    expect(source).toContain('<Button variant="ghost" size="sm" aria-label="新建口播脚本"');
    expect(source).not.toContain("ad-script-steps");
    expect(source).not.toContain('className="type-page-title">口播脚本');
  });

  test("reuses the compact record drawer and restores owned projects", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../web/features/ad-script/ad-script-page.tsx")).text();
    const apiClient = await Bun.file(resolve(import.meta.dir, "../../web/api/api-client.ts")).text();

    expect(source).toContain("<ProjectRecordDrawer");
    expect(source).toContain('queryKey="ad-script-project-records"');
    expect(source).toContain("const selected = await fetchAdScriptProject(item.id)");
    expect(source).toContain('setScreen("progress")');
    expect(source).toContain('projectStatus === "failed" ? "生成失败"');
    expect(source).toContain('projectStatus === "cancelled" ? "任务已取消"');
    expect(apiClient).toContain("export async function fetchAdScriptProjects()");
    expect(apiClient).toContain("await listAdScriptProjects");
  });
});
