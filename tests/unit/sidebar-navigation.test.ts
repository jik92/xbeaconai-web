import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const shell = readFileSync(resolve(import.meta.dir, "../../web/components/domain/app-shell.tsx"), "utf8");

describe("sidebar navigation", () => {
  test("defaults to collapsed while preserving an explicit expanded preference", () => {
    expect(shell).toContain('window.localStorage.getItem("sidebar-collapsed") !== "false"');
  });

  test("extracts generation and understanding into the AI creation group", () => {
    expect(shell).toContain('["创作工作流", "AI创作", "AI 工具箱", "实用工具", "投放", "资产"]');
    expect(shell).toContain('item.id === "ai-generate" || item.id === "media-understand"');
    expect(shell).toContain('label: item.id === "ai-generate" ? "素材生成" : item.label');
    expect(shell).toContain('item.id !== "ai-generate" && item.id !== "media-understand"');
  });
});
