import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("video remix project history", () => {
  test("loads, filters, renames, and restores persisted projects instead of rendering demo rows", () => {
    const page = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx"), "utf8");

    expect(page).toContain("fetchRemixProjects({");
    expect(page).toContain("await saveRemixProject(project.id, { title });");
    expect(page).toContain("await onContinue(await fetchRemixProject(projectId));");
    expect(page).toContain("setPromptStates(detail.workspace.promptStates);");
    expect(page).toContain("setSelectedShotAssets(detail.workspace.selectedShotAssets);");
    expect(page).toContain("正在加载项目记录…");
    expect(page).toContain("暂无项目记录");
    expect(page).not.toContain("夏日连衣裙推广");
  });

  test("persists the workspace and flushes it before starting or switching projects", () => {
    const page = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx"), "utf8");

    expect(page).toContain("const saveCurrentProject = async () =>");
    expect(page).toContain("await saveCurrentProject();\n      reset();");
    expect(page).toContain("await saveCurrentProject();\n          restoreProject(");
    expect(page).toContain("lastSavedWorkspace.current = serialized;");
  });
});
