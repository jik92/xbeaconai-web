import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("script remix entry", () => {
  test("adds a sidebar route that reuses the existing remix project", () => {
    const router = readFileSync(resolve(import.meta.dir, "../../web/app/router.tsx"), "utf8");
    const shell = readFileSync(resolve(import.meta.dir, "../../web/components/domain/app-shell.tsx"), "utf8");
    const project = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx"), "utf8");

    expect(router).toContain('path: "/aigc/script-remix"');
    expect(router).toContain('<RemixProject workflowTitle="脚本二创" workflowKind="script" />');
    expect(shell).toContain('id: "script-remix"');
    expect(shell).toContain('label: "脚本二创"');
    expect(project).toContain("workflowTitle?: string");
    expect(project).toContain('workflowKind?: "video" | "script"');
    expect(project).toContain('workflowTitle = "爆款二创"');
    expect(project).toContain('scriptRemix ? "脚本填充" : "需求描述"');
    expect(project).toContain('scriptContent: scriptRemix ? description : ""');
  });
});
