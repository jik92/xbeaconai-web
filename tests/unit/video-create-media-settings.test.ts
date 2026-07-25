import { describe, expect, test } from "bun:test";
import { allProviderFeatureAvailability, moduleFeatureAvailability } from "../../server/byok/provider-feature-gate";
import { videoCreateBatchEligibleAudioShots } from "../../server/video-create/video-create-store";
import {
  defaultVideoCreateSubtitleStyleId,
  defaultVideoCreateVoiceSettings,
  getVideoCreateSubtitlePreset,
  videoCreateSubtitlePresets,
  videoCreateVoiceContextText,
  videoCreateVoiceSettingsKey,
  videoCreateVoiceSpeechRate,
} from "../../shared/video-create/media-settings";
import { voicePresetCatalog } from "../../shared/voice/preset-voices";

describe("video create media settings", () => {
  test("uses only the four supported preset voices and stable defaults", () => {
    expect(voicePresetCatalog.map((voice) => voice.name)).toEqual(["Vivi", "刘飞", "云舟", "悬疑解说"]);
    expect(defaultVideoCreateVoiceSettings).toEqual({
      presetVoiceId: "zh_female_vv_uranus_bigtts",
      speed: "normal",
      style: "marketing",
    });
    expect(videoCreateVoiceSettingsKey(defaultVideoCreateVoiceSettings)).toBe(
      "zh_female_vv_uranus_bigtts:normal:marketing",
    );
  });

  test("maps speed and expression style to Volc Speech request values", () => {
    expect(videoCreateVoiceSpeechRate("slow")).toBe(-20);
    expect(videoCreateVoiceSpeechRate("normal")).toBe(0);
    expect(videoCreateVoiceSpeechRate("fast")).toBe(20);
    expect(videoCreateVoiceContextText("news")).toContain("新闻播报");
  });

  test("publishes six real FFmpeg subtitle styles", () => {
    expect(videoCreateSubtitlePresets).toHaveLength(6);
    expect(new Set(videoCreateSubtitlePresets.map((preset) => preset.forceStyle)).size).toBe(6);
    expect(getVideoCreateSubtitlePreset(defaultVideoCreateSubtitleStyleId).name).toBe("思源黄字");
    expect(getVideoCreateSubtitlePreset("happy-orange").forceStyle).toContain("PrimaryColour=&H000080FF");
  });

  test("selects only enabled shots with missing or stale audio", () => {
    const shots = videoCreateBatchEligibleAudioShots([
      { id: "missing", audioEnabled: true, audioArtifactId: null, audioStale: false },
      { id: "stale", audioEnabled: true, audioArtifactId: "audio", audioStale: true },
      { id: "current", audioEnabled: true, audioArtifactId: "audio", audioStale: false },
      { id: "disabled", audioEnabled: false, audioArtifactId: null, audioStale: false },
      { id: "busy", audioEnabled: true, audioArtifactId: null, audioStale: false, materialProcessing: true },
      { id: "queued", status: "queued" as const, audioEnabled: true, audioArtifactId: null, audioStale: false },
    ]);
    expect(shots.map((shot) => shot.id)).toEqual(["missing", "stale"]);
  });

  test("gates voice synthesis without gating the video-create module", () => {
    const isVerified = (providerId: string) => providerId !== "volc-speech";
    expect(moduleFeatureAvailability("video-create", isVerified)).toMatchObject({ enabled: true });
    expect(allProviderFeatureAvailability(isVerified).operations.voiceSynthesis).toMatchObject({
      enabled: false,
      unavailableProviders: ["volc-speech"],
    });
  });
});
