import { describe, expect, test } from "bun:test";
import {
  ArkMediaUnderstandingClient,
  buildArkMediaUnderstandingRequest,
  extractArkResponseText,
} from "../../server/providers/ark-media-understanding";

describe("Ark media understanding provider", () => {
  test("maps image, video and audio CDN sources into one Responses request", () => {
    const request = buildArkMediaUnderstandingRequest({
      model: "doubao-seed-2-0-lite-260428",
      reasoningEffort: "high",
      prompt: "输出镜头脚本 JSON",
      media: [
        { kind: "video", url: "https://files.xbeaconai.com/user/source.mp4" },
        { kind: "image", url: "https://files.xbeaconai.com/user/product.png" },
        { kind: "audio", url: "https://files.xbeaconai.com/user/voice.wav" },
      ],
    });
    expect(request).toMatchObject({
      model: "doubao-seed-2-0-lite-260428",
      thinking: { type: "enabled" },
      reasoning: { effort: "high" },
      text: { format: { type: "json_object" } },
    });
    expect(request.input[0]?.content).toEqual([
      { type: "input_text", text: "输出镜头脚本 JSON" },
      { type: "input_video", video_url: "https://files.xbeaconai.com/user/source.mp4" },
      { type: "input_image", image_url: "https://files.xbeaconai.com/user/product.png", detail: "high" },
      { type: "input_audio", audio_url: "https://files.xbeaconai.com/user/voice.wav" },
    ]);
  });

  test("disables thinking without sending a reasoning effort", () => {
    const request = buildArkMediaUnderstandingRequest({
      model: "doubao-seed-2-0-pro-260215",
      reasoningEffort: "off",
      prompt: "分析",
      media: [{ kind: "image", url: "https://files.xbeaconai.com/source.jpg" }],
    });
    expect(request.thinking).toEqual({ type: "disabled" });
    expect(request).not.toHaveProperty("reasoning");
  });

  test("maps SDK-uploaded files to Responses file IDs", () => {
    const request = buildArkMediaUnderstandingRequest({
      model: "doubao-seed-2-0-lite-260428",
      reasoningEffort: "medium",
      prompt: "分析",
      media: [
        { kind: "image", fileId: "file-image" },
        { kind: "video", fileId: "file-video" },
        { kind: "audio", fileId: "file-audio" },
      ],
    });
    expect(request.input[0]?.content.slice(1)).toEqual([
      { type: "input_image", file_id: "file-image", detail: "high" },
      { type: "input_video", file_id: "file-video" },
      { type: "input_audio", file_id: "file-audio" },
    ]);
  });

  test("extracts assistant output text and ignores reasoning", () => {
    expect(
      extractArkResponseText({
        status: "completed",
        output: [
          { type: "reasoning", summary: [{ type: "summary_text", text: "内部思考" }] },
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: '{"title":"结果"}' }],
          },
        ],
      }),
    ).toBe('{"title":"结果"}');
  });

  test("uses the injected official SDK client and returns request metadata", async () => {
    let submitted: unknown;
    const client = new ArkMediaUnderstandingClient("test-key", () => ({
      createResponses: async (request) => {
        submitted = request;
        return {
          id: "resp-test",
          model: "doubao-seed-2-0-lite-260428",
          status: "completed",
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: '{"title":"结果"}' }],
            },
          ],
        };
      },
      uploadFile: async () => {
        throw new Error("not used");
      },
      retrieveFile: async () => {
        throw new Error("not used");
      },
      deleteFile: async () => ({ deleted: true }),
    }));
    const result = await client.analyze({
      model: "doubao-seed-2-0-lite-260428",
      reasoningEffort: "medium",
      prompt: "分析",
      media: [{ kind: "video", url: "https://files.xbeaconai.com/source.mp4" }],
    });
    expect(submitted).toMatchObject({ model: "doubao-seed-2-0-lite-260428" });
    expect(result).toEqual({
      text: '{"title":"结果"}',
      responseId: "resp-test",
      model: "doubao-seed-2-0-lite-260428",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
  });

  test("uploads and removes a media File through the official SDK", async () => {
    const deleted: string[] = [];
    const client = new ArkMediaUnderstandingClient("test-key", () => ({
      createResponses: async () => ({}),
      uploadFile: async () => ({
        id: "file-1",
        status: "active",
        object: "file",
        purpose: "user_data",
        filename: "source.mp4",
        created_at: 1,
        expire_at: 2,
      }),
      retrieveFile: async () => {
        throw new Error("not needed");
      },
      deleteFile: async (fileId) => {
        deleted.push(fileId);
        return { deleted: true };
      },
    }));
    const uploaded = await client.uploadMedia(
      new File([new Uint8Array([1, 2, 3])], "source.mp4", { type: "video/mp4" }),
    );
    expect(uploaded).toBe("file-1");
    await client.deleteMedia("file-1");
    expect(deleted).toEqual(["file-1"]);
  });
});
