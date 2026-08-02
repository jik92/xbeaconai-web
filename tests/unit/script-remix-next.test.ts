import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { cropStoryboardGrid, probeMedia } from "../../server/media/ffmpeg";
import {
  buildScriptRemixNextAnalysisPrompt,
  buildSingleShotImagePrompt,
  buildStoryboardGridPrompt,
  parseScriptRemixNextAnalysis,
} from "../../server/script-remix-next/model";
import {
  createScriptRemixNextWorkspace,
  normalizeScriptRemixNextShots,
  type ScriptRemixNextShot,
  scriptRemixNextAnalysisModel,
  scriptRemixNextCompletePrompt,
  scriptRemixNextImageModel,
  scriptRemixNextReadyToCompose,
  scriptRemixNextShotSettings,
} from "../../shared/script-remix-next/workflow";
import { decodeScriptDocument } from "../../worker/jobs/job-script-remix-next";

const tempDirs: string[] = [];
afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

function shot(index: number): ScriptRemixNextShot {
  return {
    id: crypto.randomUUID(),
    ordinal: index,
    title: `分镜 ${index}`,
    speech: `原文${index}`,
    visual: `画面描述${index}`,
    action: `动作${index}`,
    camera: `运镜${index}`,
    durationSeconds: 4,
    productRequirement: `商品${index}`,
    characterRequirement: `人物${index}`,
  };
}

describe("script remix next workflow", () => {
  test("keeps fewer than nine shots and merges overflow without losing speech", () => {
    expect(normalizeScriptRemixNextShots([shot(1), shot(2)])).toHaveLength(2);
    const input = Array.from({ length: 11 }, (_, index) => shot(index + 1));
    const output = normalizeScriptRemixNextShots(input);
    expect(output).toHaveLength(9);
    expect(output[8]?.speech).toBe("原文9\n原文10\n原文11");
    expect(output.map((item) => item.speech).join("\n")).toContain("原文11");
    expect(output.map((item) => item.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("parses structured model output and fixes ordinals", () => {
    const raw = Array.from({ length: 3 }, (_, index) => ({
      title: `镜头 ${index + 1}`,
      speech: `脚本 ${index + 1}`,
      visual: `具体画面描述 ${index + 1}`,
      action: "展示商品",
      camera: "中景推进",
      durationSeconds: 6,
      productRequirement: "保持商品一致",
      characterRequirement: "保持人物一致",
    }));
    const result = parseScriptRemixNextAnalysis(`\`\`\`json\n${JSON.stringify({ shots: raw })}\n\`\`\``);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ ordinal: 1, title: "镜头 1" });
    expect(result.every((item) => /^[0-9a-f-]{36}$/.test(item.id))).toBe(true);
  });

  test("uses the fixed models and emits explicit blank storyboard cells", () => {
    expect(scriptRemixNextAnalysisModel).toBe("gpt-5.6-sol");
    expect(scriptRemixNextImageModel).toBe("gpt-image-2");
    const analysis = buildScriptRemixNextAnalysisPrompt({
      script: "这是一份足够长的原始脚本内容，用于验证模型提示词不会丢失原文。",
      productName: "测试商品",
      productDescription: "商品描述",
    });
    expect(analysis).toContain("最多输出 9 条");
    expect(analysis).toContain("不得改写、删减、重复或调序");
    const grid = buildStoryboardGridPrompt({ shots: [shot(1), shot(2)], productName: "测试商品" });
    expect(grid).toContain("严格 3×3");
    expect(grid.match(/空白占位格/g)).toHaveLength(7);
  });

  test("uses one editable complete prompt as the authoritative generation input", () => {
    const current = shot(1);
    const fallback = scriptRemixNextCompletePrompt(current);
    expect(fallback).toContain("口播文案：原文1");
    expect(fallback).toContain("景别、机位和运镜：运镜1");
    current.prompt = "这是用户调整后的完整提示词，包含口播、画面、动作、运镜以及人物和商品一致性。";
    expect(scriptRemixNextCompletePrompt(current)).toBe(current.prompt);
    expect(buildStoryboardGridPrompt({ shots: [current], productName: "测试商品" })).toContain(current.prompt);
    expect(buildSingleShotImagePrompt({ shot: current, productName: "测试商品" })).toContain(current.prompt);
  });

  test("accepts UTF-8 TXT and Markdown while rejecting invalid documents", () => {
    const content = "这是一份有效的 UTF-8 脚本文档，长度足够用于后续分镜解析。";
    expect(decodeScriptDocument(new TextEncoder().encode(`\uFEFF${content}`), "text/plain", "script.txt")).toBe(
      content,
    );
    expect(decodeScriptDocument(new TextEncoder().encode(content), "text/markdown", "script.md")).toBe(content);
    expect(() => decodeScriptDocument(new TextEncoder().encode(content), "application/pdf", "script.pdf")).toThrow(
      "SCRIPT_DOCUMENT_TYPE_UNSUPPORTED",
    );
    expect(() => decodeScriptDocument(new Uint8Array([0xff, 0xfe, 0xfd]), "text/plain", "script.txt")).toThrow();
  });

  test("inherits global video settings and requires one selected video per shot", () => {
    const workspace = createScriptRemixNextWorkspace();
    const shots = [shot(1), shot(2)];
    const firstShot = shots[0];
    if (!firstShot) throw new Error("TEST_SHOT_MISSING");
    workspace.shots = shots;
    workspace.composeOrder = shots.map((item) => item.id);
    workspace.shotVideoSettings[firstShot.id] = { duration: 12 };
    expect(scriptRemixNextShotSettings(workspace, firstShot.id)).toMatchObject({ ratio: "9:16", duration: 12 });
    expect(scriptRemixNextReadyToCompose(workspace)).toBe(false);
    workspace.selectedVideoAssetIds = Object.fromEntries(shots.map((item) => [item.id, crypto.randomUUID()]));
    expect(scriptRemixNextReadyToCompose(workspace)).toBe(true);
  });

  test("crops valid storyboard cells through FFmpeg", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "script-remix-next-grid-"));
    tempDirs.push(dir);
    const input = resolve(dir, "grid.png");
    const process = Bun.spawn([
      "ffmpeg",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=white:s=900x1200",
      "-frames:v",
      "1",
      input,
    ]);
    expect(await process.exited).toBe(0);
    const outputs = [resolve(dir, "one.png"), resolve(dir, "two.png")];
    expect(await cropStoryboardGrid(input, outputs)).toEqual({ width: 300, height: 400 });
    for (const output of outputs) {
      const media = await probeMedia(output);
      expect(media.streams.find((stream) => stream.codec_type === "video")).toMatchObject({ width: 300, height: 400 });
    }
  });
});

describe("script remix next entry", () => {
  test("registers an adjacent independent menu and route", async () => {
    const [shell, router, page, legacyPage] = await Promise.all([
      Bun.file(resolve(import.meta.dir, "../../web/components/domain/app-shell.tsx")).text(),
      Bun.file(resolve(import.meta.dir, "../../web/app/router.tsx")).text(),
      Bun.file(resolve(import.meta.dir, "../../web/features/script-remix-next/script-remix-next-page.tsx")).text(),
      Bun.file(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx")).text(),
    ]);
    expect(shell).toContain('label: "脚本二创【新】"');
    expect(shell).toContain('path: "/aigc/script-remix-next"');
    expect(router).toContain("<ScriptRemixNextPage />");
    expect(router).toContain('moduleId="script-remix-next"');
    expect(page).toContain("<Switch");
    expect(page).toContain("<ProductPickerModal");
    expect(page).toContain('presentation="wide"');
    expect(legacyPage).toContain("export function ProductPickerModal");
    expect(page).toContain("完整提示词");
    expect(page).not.toContain("口播文案`}");
    expect(page).not.toContain("画面描述`}");
  });
});
