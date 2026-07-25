import { describe, expect, test } from "bun:test";
import { buildSeedanceVideoRequest } from "../../server/providers/aihubmix";

describe("AIHubMix Seedance request contract", () => {
  test("sends Mini duration through the top-level seconds field", () => {
    expect(
      buildSeedanceVideoRequest({
        model: "doubao-seedance-2-0-mini-260615",
        prompt: "十五秒竖屏视频",
        duration: 15,
        ratio: "9:16",
        resolution: "720p",
        generateAudio: true,
        watermark: false,
      }),
    ).toEqual({
      model: "doubao-seedance-2-0-mini-260615",
      prompt: "十五秒竖屏视频",
      seconds: "15",
      extra_body: {
        resolution: "720p",
        ratio: "9:16",
        generate_audio: true,
        watermark: false,
      },
    });
  });

  for (const model of ["doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128"] as const) {
    test(`keeps the compatibility duration field for ${model}`, () => {
      const request = buildSeedanceVideoRequest({ model, prompt: "测试", duration: 15 });
      expect(request.seconds).toBe("15");
      expect(request.extra_body.duration).toBe(15);
    });
  }

  test("keeps typed reference content in the request", () => {
    const request = buildSeedanceVideoRequest({
      model: "doubao-seedance-2-0-mini-260615",
      prompt: "参考素材",
      references: [{ kind: "video", url: "https://example.com/reference.mp4" }],
    });
    expect(request.extra_body.content).toEqual([
      {
        type: "video_url",
        video_url: { url: "https://example.com/reference.mp4" },
        role: "reference_video",
      },
    ]);
  });
});
