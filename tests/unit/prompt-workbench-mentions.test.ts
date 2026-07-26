import { describe, expect, test } from "bun:test";
import { promptMentionDeletionRange } from "../../web/components/domain/prompt-workbench";

const mentions = [{ id: "flower", label: "Image1", name: "鲜花" }];
const prompt = "请参考 @Image1 生成视频";
const start = prompt.indexOf("@Image1");
const end = start + "@Image1".length;

describe("PromptWorkbench 原子引用", () => {
  test("backspace deletes the full mention when the caret is inside it", () => {
    expect(promptMentionDeletionRange(prompt, mentions, start + 3, start + 3, "Backspace")).toEqual({ start, end });
  });

  test("delete deletes the full mention from its leading edge", () => {
    expect(promptMentionDeletionRange(prompt, mentions, start, start, "Delete")).toEqual({ start, end });
  });

  test("a partial selection expands to the entire mention", () => {
    expect(promptMentionDeletionRange(prompt, mentions, start + 2, start + 5, "Backspace")).toEqual({ start, end });
  });
});
