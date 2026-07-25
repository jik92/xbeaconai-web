import { describe, expect, test } from "bun:test";
import { isModuleOpen } from "../../web/app/config";
import {
  allProviderFeatureAvailability,
  moduleFeatureAvailability,
  moduleProviderRequirements,
} from "../../server/byok/provider-feature-gate";
import type { ProviderId } from "../../server/byok/credential-store";

describe("Provider feature gate", () => {
  test("enables only modules whose required Providers have passed", () => {
    const passed = new Set<ProviderId>(["aihubmix", "volc-speech"]);
    const isVerified = (providerId: ProviderId) => passed.has(providerId);

    expect(moduleFeatureAvailability("ad-script", isVerified).enabled).toBe(true);
    expect(moduleFeatureAvailability("voice-clone", isVerified).enabled).toBe(false);
    expect(moduleFeatureAvailability("video-remix", isVerified)).toMatchObject({
      enabled: false,
      unavailableProviders: ["ark", "tos"],
    });
    expect(moduleFeatureAvailability("subtitle-erase", isVerified)).toMatchObject({
      enabled: false,
      unavailableProviders: ["mediakit", "tos"],
    });
    expect(allProviderFeatureAvailability(isVerified).operations.assetUpload.enabled).toBe(false);
    expect(allProviderFeatureAvailability(isVerified).operations.portraitCreation.enabled).toBe(false);
  });

  test("enables new voice-clone tasks only through verified Qwen with TOS", () => {
    const qwenAndTos = new Set<ProviderId>(["qwen-audio", "tos"]);
    expect(moduleProviderRequirements["voice-clone"]).toEqual(["qwen-audio", "tos"]);
    expect(moduleFeatureAvailability("voice-clone", (providerId) => qwenAndTos.has(providerId)).enabled).toBe(true);
    expect(moduleFeatureAvailability("voice-clone", (providerId) => providerId === "volc-speech").enabled).toBe(false);
    expect(moduleFeatureAvailability("voice-clone", (providerId) => providerId === "qwen-audio")).toMatchObject({
      enabled: false,
      unavailableProviders: ["tos"],
    });
  });

  test("keeps static menuFeatures decisions separate from Provider verification", () => {
    expect(isModuleOpen("ai-generate")).toBe(true);
    expect(moduleProviderRequirements["ai-generate"]).toEqual(["aihubmix", "ark"]);
    expect(isModuleOpen("video-cut")).toBe(true);
  });
});
