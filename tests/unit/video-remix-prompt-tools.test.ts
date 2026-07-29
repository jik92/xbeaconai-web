import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { remixModifyPresets } from "../../shared/video-remix/prompt-tools";

describe("video remix prompt tools", () => {
  test("publishes the three real AI tools through an owned queued API job", async () => {
    const source = readFileSync(resolve(import.meta.dir, "../../server/app.ts"), "utf8");
    const spec = (await Bun.file(resolve(import.meta.dir, "../../openapi/openapi.json")).json()) as {
      paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, unknown> }>>;
    };
    const route = spec.paths["/api/video-remix/prompt-tools"]?.post;
    expect(route?.operationId).toBe("createVideoRemixPromptToolJob");
    expect(route?.responses).toHaveProperty("202");
    expect(route?.responses).toHaveProperty("404");
    expect(route?.responses).toHaveProperty("409");
    expect(route?.responses).toHaveProperty("422");
    expect(source).toContain('operationId: "createVideoRemixPromptToolJob"');
    expect(source).toContain("store.getOwned(body.sourceJobId, ownerUserId)");
    expect(source).toContain("body.sourceAssetId");
    expect(source).toContain('workflowPhase: "prompt-rewrite"');
    expect(source).toContain("await queue.enqueue(job.id)");
    expect(source).toContain('model: "deepseek-v4-pro"');
  });

  test("keeps all requested modify presets and full-screen modal controls", () => {
    expect(remixModifyPresets.map((preset) => preset.title)).toEqual(["美妆人脸美白水光", "人脸美白", "商品替换"]);
    const modal = readFileSync(
      resolve(import.meta.dir, "../../web/features/video-remix/prompt-tool-modal.tsx"),
      "utf8",
    );
    expect(modal).toContain("toolTitles[tool]");
    expect(modal).toContain("h-[calc(100vh-24px)]");
    expect(modal).toContain("脚本智能检查");
    expect(modal).toContain("脚本智能修改");
    expect(modal).toContain("智能更换口播");
    expect(modal).toContain("修正口播");
    expect(modal).toContain("换口播");
    expect(modal).toContain("runRemixPromptTool");
    expect(modal).toContain("sourceAssetId");
    expect(modal).toContain('variant="ghost"');
    expect(modal).toContain("min-h-[72px]");
    expect(modal).toContain("取消选择");
    expect(modal).toContain("hover:text-ink");
  });

  test("requires review of every AI rewrite before applying it to the project", () => {
    const modal = readFileSync(
      resolve(import.meta.dir, "../../web/features/video-remix/prompt-tool-modal.tsx"),
      "utf8",
    );
    expect(modal).toContain("pendingRewrite");
    expect(modal).toContain("修改前后对比");
    expect(modal).toContain("编辑修改后内容");
    expect(modal).toContain("继续编辑");
    expect(modal).toContain("重新生成");
    expect(modal).toContain("应用修改");
    expect(modal).toContain("saveRewrite");
    expect(modal).not.toContain("onApply(currentTool, rewritten, summary, findings)");
  });

  test("replaces placeholder toolbar actions with modal entry points", () => {
    const page = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx"), "utf8");
    expect(page).toContain('setPromptTool("check")');
    expect(page).toContain('setPromptTool("modify")');
    expect(page).toContain('setPromptTool("voice")');
    expect(page).toContain("patchPromptState(activeSourceId");
    expect(page).toContain("prompt: rewrittenPrompt");
    expect(page).not.toContain("AI 优化：强化前三秒冲突");
    expect(page).not.toContain("智能检查通过：结构完整，未发现冲突");
  });

  test("shows the applied rewrite as a highlighted comparison in the right-side prompt workspace", () => {
    const page = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx"), "utf8");
    expect(page).toContain("promptComparisons");
    expect(page).toContain("setCompare(true)");
    expect(page).toContain('aria-label="修改前后对比"');
    expect(page).toContain("prompt-document-comparison");
    expect(page).toContain("buildLineDiff");
  });

  test("lets users safely return to the previous editable workflow step", () => {
    const page = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx"), "utf8");
    expect(page).toContain("onPrevious");
    expect(page).toContain("上一步");
    expect(page).toContain("disabled={stage <= 2}");
    expect(page).toContain("setStage((current) => Math.max(2, current - 1))");
  });
});
