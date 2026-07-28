import { describe, expect, test } from "bun:test";
import { voicePreviewStorageKey } from "../../server/video-create/voice-preview";

describe("video create voice preview", () => {
  test("uses a stable user-scoped ephemeral MP3 key", () => {
    const settings = {
      presetVoiceId: "zh_female_vv_uranus_bigtts" as const,
      speed: "normal" as const,
      style: "marketing" as const,
    };
    const first = voicePreviewStorageKey({
      ownerUserId: "user-1",
      voiceSettings: settings,
      text: "测试试听",
    });
    expect(first).toMatch(/^ephemeral\/voice-previews\/user-1\/[a-f0-9]{64}\.mp3$/);
    expect(
      voicePreviewStorageKey({
        ownerUserId: "user-1",
        voiceSettings: settings,
        text: "测试试听",
      }),
    ).toBe(first);
    expect(
      voicePreviewStorageKey({
        ownerUserId: "user-2",
        voiceSettings: settings,
        text: "测试试听",
      }),
    ).not.toBe(first);
  });
});
