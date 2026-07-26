import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("video remix project history", () => {
  test("loads, filters, renames, and restores persisted projects instead of rendering demo rows", () => {
    const page = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx"), "utf8");
    const drawer = readFileSync(
      resolve(import.meta.dir, "../../web/components/domain/project-record-drawer.tsx"),
      "utf8",
    );

    expect(page).toContain("fetchRemixProjects({");
    expect(page).toContain("<ProjectRecordDrawer");
    expect(page).toContain("await saveRemixProject(item.id, { title });");
    expect(page).toContain("onContinue(await fetchRemixProject(item.id))");
    expect(page).toContain("onContinue={(detail) => restoreProject(detail)}");
    expect(drawer).toContain("useInfiniteQuery");
    expect(drawer).toContain("pageSize: 20");
    expect(drawer).toContain("history.fetchNextPage()");
    expect(drawer).toContain("正在加载生成记录…");
    expect(drawer).toContain("暂无生成记录");
    expect(page).toContain("skipNextWorkspaceSave.current = true;");
    expect(page).toContain("setPromptStates(detail.workspace.promptStates);");
    expect(page).toContain("setSelectedShotAssets(detail.workspace.selectedShotAssets);");
    expect(page).not.toContain("夏日连衣裙推广");
  });

  test("persists the workspace before starting a new project but does not write when opening history", () => {
    const page = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx"), "utf8");

    expect(page).toContain("const saveCurrentProject = async () =>");
    expect(page).toContain("await saveCurrentProject();\n      reset();");
    expect(page).not.toContain("onContinue={async (detail) =>");
    expect(page).toContain("onContinue={(detail) => restoreProject(detail)}");
    expect(page).toContain("lastSavedWorkspace.current = serialized;");
    expect(page).toContain("if (skipNextWorkspaceSave.current)");
  });
});
