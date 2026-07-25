import { describe, expect, test } from "bun:test";
import { validateQwenVoiceSampleProbe } from "../../server/voice/qwen-voice-sample-preflight";

describe("Qwen voice sample preflight", () => {
  test("reports the actual duration when a sample is shorter than five seconds", () => {
    expect(() =>
      validateQwenVoiceSampleProbe({
        durationSec: 2.56,
        hasAudioStream: true,
        format: "wav",
        channels: 1,
        sampleRate: 24_000,
      }),
    ).toThrow("当前录音 2.56 秒，至少需要 5 秒");
  });

  test("returns safe metadata for a valid sample", () => {
    expect(
      validateQwenVoiceSampleProbe({
        durationSec: 14.25,
        hasAudioStream: true,
        format: "wav",
        channels: 1,
        sampleRate: 24_000,
      }),
    ).toEqual({ durationSec: 14.25, format: "wav", channels: 1, sampleRate: 24_000 });
  });
});
