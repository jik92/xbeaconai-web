import { describe, expect, test } from "bun:test";
import { QwenAudioProvider } from "../../server/providers/qwen-audio";
import * as qwenVoice from "../../shared/voice/qwen-voice";

const config = {
  apiKey: "qwen-secret",
  workspaceId: "ws-test",
};

describe("QwenAudioProvider", () => {
  test("builds an enrollment prefix within Qwen's ten-character limit", () => {
    expect("qwenVoicePrefix" in qwenVoice).toBe(true);
    const prefix = (
      qwenVoice as typeof qwenVoice & {
        qwenVoicePrefix?: (jobId: string) => string;
      }
    ).qwenVoicePrefix?.("12345678-90ab-cdef-1234-567890abcdef");

    expect(prefix).toBe("v123456789");
    expect(prefix?.length).toBeLessThanOrEqual(10);
    expect(prefix).toMatch(/^[a-z][a-z0-9]{0,9}$/);
  });

  test("creates a Plus voice through the official enrollment endpoint", async () => {
    const provider = new QwenAudioProvider(config, async (url, init) => {
      expect(url).toBe("https://ws-test.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer qwen-secret" });
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "voice-enrollment",
        input: {
          action: "create_voice",
          target_model: "qwen-audio-3.0-tts-plus",
          prefix: "voiceabc123",
          url: "https://files.example.com/sample.wav",
        },
      });
      return Response.json({ output: { voice_id: "qwen-audio-3.0-tts-plus-voiceabc123-id" }, request_id: "req-1" });
    });

    await expect(provider.createVoice("https://files.example.com/sample.wav", "voiceabc123")).resolves.toEqual({
      voiceId: "qwen-audio-3.0-tts-plus-voiceabc123-id",
      requestId: "req-1",
    });
  });

  test("synthesizes a cloned voice with dialect and style instruction", async () => {
    const provider = new QwenAudioProvider(config, async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "qwen-audio-3.0-tts-plus",
        input: {
          voice: "voice-id",
          instruction: expect.stringContaining("广东话"),
          language_hints: ["zh"],
        },
      });
      return Response.json({ output: { audio: { url: "https://files.example.com/result.wav" } }, request_id: "req-2" });
    });

    await expect(
      provider.synthesize({
        voiceId: "voice-id",
        text: "恭喜发财！",
        dialect: "广东话",
        style: "广告配音风格",
        speed: "快速",
      }),
    ).resolves.toEqual({ audioUrl: "https://files.example.com/result.wav", requestId: "req-2" });
  });

  test("controls Qwen speed through the documented instruction field", async () => {
    const instructions: string[] = [];
    const provider = new QwenAudioProvider(config, async (_url, init) => {
      instructions.push(JSON.parse(String(init?.body)).input.instruction);
      return Response.json({ output: { audio: { url: "https://files.example.com/result.wav" } } });
    });

    for (const speed of ["慢速", "标准", "快速"] as const)
      await provider.synthesize({
        voiceId: "voice-id",
        text: "测试语速",
        dialect: "普通话",
        style: "标准播音风格",
        speed,
      });

    expect(instructions[0]).toContain("较慢");
    expect(instructions[1]).toContain("适中");
    expect(instructions[2]).toContain("较快");
  });
});
