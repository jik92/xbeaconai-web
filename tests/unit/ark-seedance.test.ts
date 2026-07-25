import { describe, expect, test } from "bun:test";
import {
  ArkSeedanceClient,
  type ArkSeedanceVideoInput,
  buildArkSeedanceVideoRequest,
} from "../../server/providers/ark-seedance";

const input: ArkSeedanceVideoInput = {
  model: "doubao-seedance-2-0-mini-260615",
  prompt: "固定机位，近景。图片1中的人物面对镜头微笑并轻轻挥手。人脸清晰，无字幕。",
  references: [{ kind: "image", url: "asset://asset-20260224201548-dthqc" }],
  resolution: "720p",
  ratio: "3:4",
  duration: 5,
  generateAudio: false,
  watermark: false,
};

describe("Ark Seedance request contract", () => {
  test("keeps the virtual portrait asset and native reference role in content", () => {
    expect(buildArkSeedanceVideoRequest(input)).toEqual({
      model: "doubao-seedance-2-0-mini-260615",
      content: [
        { type: "text", text: input.prompt },
        {
          type: "image_url",
          image_url: { url: "asset://asset-20260224201548-dthqc" },
          role: "reference_image",
        },
      ],
      generate_audio: false,
      resolution: "720p",
      ratio: "3:4",
      duration: 5,
      watermark: false,
    });
  });

  test("never retries a paid task creation request", async () => {
    let calls = 0;
    const client = new ArkSeedanceClient("https://ark.example.test/api/v3", "test-key", async () => {
      calls += 1;
      return new Response('{"error":{"message":"temporary failure"}}', { status: 503 });
    });

    await expect(client.createVideo(input)).rejects.toThrow("ARK_503");
    expect(calls).toBe(1);
  });

  test("submits the native request to the Ark task endpoint", async () => {
    let capturedUrl = "";
    let capturedBody: unknown;
    const client = new ArkSeedanceClient("https://ark.example.test/api/v3", "test-key", async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body));
      return Response.json({ id: "task-1", status: "queued" });
    });

    const task = await client.createVideo(input);

    expect(task.id).toBe("task-1");
    expect(capturedUrl).toBe("https://ark.example.test/api/v3/contents/generations/tasks");
    expect(capturedBody).toEqual(buildArkSeedanceVideoRequest(input));
  });

  test("maps image, video and audio references to Ark native content", () => {
    expect(
      buildArkSeedanceVideoRequest({
        ...input,
        references: [
          { kind: "image", url: "asset://asset-image" },
          { kind: "video", url: "https://example.test/reference.mp4" },
          { kind: "audio", url: "https://example.test/reference.wav" },
        ],
      }).content.slice(1),
    ).toEqual([
      { type: "image_url", image_url: { url: "asset://asset-image" }, role: "reference_image" },
      {
        type: "video_url",
        video_url: { url: "https://example.test/reference.mp4" },
        role: "reference_video",
      },
      {
        type: "audio_url",
        audio_url: { url: "https://example.test/reference.wav" },
        role: "reference_audio",
      },
    ]);
  });

  test("cancels through the Ark task endpoint without retrying", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const client = new ArkSeedanceClient("https://ark.example.test/api/v3", "test-key", async (url, init) => {
      calls.push({ url: String(url), method: init?.method });
      return new Response(null, { status: 204 });
    });

    await expect(client.cancelVideo("task/1")).resolves.toBe("requested");
    expect(calls).toEqual([
      { url: "https://ark.example.test/api/v3/contents/generations/tasks/task%2F1", method: "DELETE" },
    ]);
  });
});
