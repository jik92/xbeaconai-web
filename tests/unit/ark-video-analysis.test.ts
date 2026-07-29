import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ArkVideoAnalysisClient, type ArkVideoAnalysisInput } from "../../server/providers/ark-video-analysis";

describe("Ark video analysis", () => {
  test("routes video-remix analysis to the Ark video-understanding client", async () => {
    const workerSource = await Bun.file(
      resolve(import.meta.dir, "../../worker/jobs/job-video-remix-analysis.ts"),
    ).text();

    expect(workerSource).toContain('provider: "ark"');
    expect(workerSource).toContain("arkVideoAnalysis.analyzeVideo");
    expect(workerSource).not.toContain("analyzeVideoWithGemini");
  });

  test("submits video and product images through Ark chat completions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ark-video-analysis-"));
    const videoPath = join(directory, "source.mp4");
    const imagePath = join(directory, "product.jpg");
    await writeFile(videoPath, "video");
    await writeFile(imagePath, "image");
    let request: { url: string; headers?: HeadersInit; body?: string } | undefined;
    const client = new ArkVideoAnalysisClient("https://ark.example.test/api/v3", "test-key", async (url, init) => {
      request = { url: String(url), headers: init?.headers, body: String(init?.body) };
      return Response.json({
        model: "doubao-seed-2-0-mini-260428",
        choices: [{ message: { content: "解析结果" } }],
      });
    });

    const input: ArkVideoAnalysisInput = {
      videoPath,
      mimeType: "video/mp4",
      prompt: "分析视频",
      model: "doubao-seed-2-0-mini-260428",
      productImages: [{ path: imagePath, mimeType: "image/jpeg" }],
    };
    const result = await client.analyzeVideo(input);
    const body = JSON.parse(request?.body ?? "{}") as { messages?: Array<{ content?: unknown[] }> };

    expect(request?.url).toBe("https://ark.example.test/api/v3/chat/completions");
    expect(new Headers(request?.headers).get("authorization")).toBe("Bearer test-key");
    expect(body.messages?.[0]?.content).toContainEqual({
      type: "video_url",
      video_url: { url: "data:video/mp4;base64,dmlkZW8=" },
    });
    expect(body.messages?.[0]?.content).toContainEqual({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,aW1hZ2U=" },
    });
    expect(result).toEqual({ text: "解析结果", model: "doubao-seed-2-0-mini-260428" });
  });
});
