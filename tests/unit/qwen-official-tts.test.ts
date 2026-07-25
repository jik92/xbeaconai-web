import { describe, expect, test } from "bun:test";
import {
  buildQwenTtsInstruction,
  buildQwenTtsRequest,
  parseQwenTtsArgs,
  qwenTtsSampleCases,
} from "../../scripts/qwen-official-tts";

describe("Qwen official TTS CLI", () => {
  test("parses a supported dialect and style into explicit CLI options", () => {
    expect(
      parseQwenTtsArgs([
        "--dialect",
        "广东话",
        "--style",
        "广告配音风格",
        "--text",
        "恭喜发财，天天向上！",
        "--voice",
        "longanlufeng",
        "--seed",
        "42",
      ]),
    ).toMatchObject({
      dialect: "广东话",
      style: "广告配音风格",
      text: "恭喜发财，天天向上！",
      voice: "longanlufeng",
      seed: 42,
      samples: false,
    });
  });

  test("rejects unknown dialects, styles, and invalid seeds", () => {
    expect(() => parseQwenTtsArgs(["--dialect", "火星话"])).toThrow("不支持的方言");
    expect(() => parseQwenTtsArgs(["--style", "随便说"])).toThrow("不支持的配音风格");
    expect(() => parseQwenTtsArgs(["--seed", "70000"])).toThrow("seed");
  });

  test("combines an official dialect and style into one instruction", () => {
    expect(buildQwenTtsInstruction("广东话", "广告配音风格")).toContain("自然地道的广东话");
    expect(buildQwenTtsInstruction("广东话", "广告配音风格")).toContain("广告配音");
  });

  test("builds the official nested SpeechSynthesizer request", () => {
    expect(
      buildQwenTtsRequest({
        model: "qwen-audio-3.0-tts-plus",
        voice: "longanlingxin",
        dialect: "四川话",
        style: "情绪递进风格",
        text: "这个消息真的太好了！",
        seed: 7,
      }),
    ).toEqual({
      model: "qwen-audio-3.0-tts-plus",
      input: {
        text: "这个消息真的太好了！",
        voice: "longanlingxin",
        format: "wav",
        sample_rate: 24000,
        seed: 7,
        language_hints: ["zh"],
        instruction:
          "请用自然地道的四川话表达，不要使用普通话播音腔。情绪从自然平稳逐步增强到兴奋有感染力，转折自然，不要突然喊叫。",
      },
    });
  });

  test("publishes eight listening samples using only official dialects", () => {
    expect(qwenTtsSampleCases).toHaveLength(8);
    expect(qwenTtsSampleCases.map((sample) => sample.dialect)).toContain("湖南话");
    expect(qwenTtsSampleCases.map((sample) => sample.dialect)).toContain("重庆话");
  });
});
