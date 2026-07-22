import { describe, expect, test } from "bun:test";
import {
  buildVideoRemixPromptRewriteRequest,
  parseVideoRemixPromptRewrite,
  rewriteVideoRemixPrompt,
  VIDEO_REMIX_PROMPT_MODEL,
  VideoRemixPromptModelError,
} from "../../server/video-remix/prompt-rewrite";
import { defaultRemixPromptToolConfig } from "../../shared/video-remix/prompt-tools";

const currentPrompt = `### 第一部分：全局基础设定
商品形态：银色耳饰

### 第二部分：分镜内容
分镜 01
画面口播文案：无
分镜时长：2秒`;

describe("video remix prompt rewrite", () => {
  test("parses a complete structured rewrite from fenced model output", () => {
    expect(
      parseVideoRemixPromptRewrite(
        `\`\`\`json\n${JSON.stringify({ prompt: currentPrompt, summary: "结构已检查", findings: ["补全口播"] })}\n\`\`\``,
      ),
    ).toEqual({ prompt: currentPrompt, summary: "结构已检查", findings: ["补全口播"] });
  });

  test("builds tool-specific instructions while preserving the full prompt contract", () => {
    const modify = buildVideoRemixPromptRewriteRequest({
      tool: "modify",
      config: { ...defaultRemixPromptToolConfig, preset: "beauty-soft", customInstruction: "保持耳饰颜色" },
      prompt: currentPrompt,
    });
    expect(modify).toContain("美妆人脸美白水光");
    expect(modify).toContain("保持耳饰颜色");
    expect(modify).toContain("返回修改后的完整 Markdown 提示词");
    expect(modify).toContain(currentPrompt);

    const voice = buildVideoRemixPromptRewriteRequest({
      tool: "voice",
      config: { ...defaultRemixPromptToolConfig, voiceMode: "replace", customInstruction: "改为轻松种草语气" },
      prompt: currentPrompt,
    });
    expect(voice).toContain("只重写各分镜的画面口播文案");
    expect(voice).toContain("改为轻松种草语气");
  });

  test("uses the real DeepSeek model and retries one invalid response", async () => {
    const calls: Array<{ model: string; json: boolean }> = [];
    const result = await rewriteVideoRemixPrompt(
      { tool: "check", config: defaultRemixPromptToolConfig, prompt: currentPrompt },
      async (_request, model, options) => {
        calls.push({ model, json: options.json });
        if (calls.length === 1) return { text: "not json", model };
        return {
          text: JSON.stringify({ prompt: currentPrompt, summary: "检查完成", findings: [] }),
          model,
          usage: { total_tokens: 100 },
        };
      },
    );

    expect(calls).toEqual([
      { model: VIDEO_REMIX_PROMPT_MODEL, json: true },
      { model: VIDEO_REMIX_PROMPT_MODEL, json: true },
    ]);
    expect(result).toMatchObject({ prompt: currentPrompt, summary: "检查完成", model: VIDEO_REMIX_PROMPT_MODEL });
  });

  test("maps provider failures to a safe retryable error", async () => {
    const pending = rewriteVideoRemixPrompt(
      { tool: "modify", config: defaultRemixPromptToolConfig, prompt: currentPrompt },
      () => Promise.reject(new Error("AIHUBMIX_502: upstream detail")),
    );

    await expect(pending).rejects.toBeInstanceOf(VideoRemixPromptModelError);
    await expect(pending).rejects.toMatchObject({
      code: "MODEL_PROVIDER_ERROR",
      message: "提示词改写服务调用失败，请稍后重试",
      retryable: true,
    });
  });
});
