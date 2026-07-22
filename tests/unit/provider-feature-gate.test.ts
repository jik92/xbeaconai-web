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
    expect(moduleFeatureAvailability("voice-clone", isVerified).enabled).toBe(true);
    expect(moduleFeatureAvailability("video-remix", isVerified)).toMatchObject({
      enabled: false,
      unavailableProviders: ["tos"],
    });
    expect(moduleFeatureAvailability("subtitle-erase", isVerified)).toMatchObject({
      enabled: false,
      unavailableProviders: ["mediakit", "tos"],
    });
    expect(allProviderFeatureAvailability(isVerified).operations.assetUpload.enabled).toBe(false);
  });

  test("keeps static menuFeatures decisions separate from Provider verification", () => {
    expect(isModuleOpen("ai-generate")).toBe(false);
    expect(moduleProviderRequirements["ai-generate"]).toEqual(["aihubmix"]);
    expect(isModuleOpen("video-cut")).toBe(true);
  });
});
