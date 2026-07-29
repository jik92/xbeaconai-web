import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArkMultimodalTextClient } from "../../server/providers/ark-multimodal-text";

describe("Ark multimodal text", () => {
  test("submits labelled product images to Ark chat completions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ark-multimodal-text-"));
    const imagePath = join(directory, "product.jpg");
    await writeFile(imagePath, "image");
    let requestBody = "";
    const client = new ArkMultimodalTextClient("https://ark.example.test/api/v3", "test-key", async (_url, init) => {
      requestBody = String(init?.body);
      return Response.json({
        model: "deepseek-v4-pro-260425",
        choices: [{ message: { content: '{"ok":true}' } }],
      });
    });
    const result = await client.generate({
      prompt: "分析商品图",
      model: "deepseek-v4-pro-260425",
      images: [{ path: imagePath, mimeType: "image/jpeg", label: "Image1" }],
      maxTokens: 1_000,
      temperature: 0,
      json: true,
      timeoutMs: 10_000,
    });
    const body = JSON.parse(requestBody) as {
      model?: string;
      messages?: Array<{ content?: Array<{ type?: string; text?: string; image_url?: { url?: string } }> }>;
    };
    expect(body.model).toBe("deepseek-v4-pro-260425");
    expect(body.messages?.[0]?.content).toContainEqual({
      type: "text",
      text: "Image1：商品参考图，只能提取图中真实可见的商品特征。",
    });
    expect(
      body.messages?.[0]?.content?.some((item) => item.image_url?.url?.startsWith("data:image/jpeg;base64,")),
    ).toBe(true);
    expect(result.model).toBe("deepseek-v4-pro-260425");
  });
});
