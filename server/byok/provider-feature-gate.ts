import type { ModuleId } from "../../web/entities/types";
import { type ProviderId, providerCredentialCatalog, providerCredentials, providerIds } from "./credential-store";

export interface FeatureAvailability {
  enabled: boolean;
  requiredProviders: ProviderId[];
  unavailableProviders: ProviderId[];
  disabledReason?: string;
}

export const moduleProviderRequirements: Record<ModuleId, ProviderId[]> = {
  "video-remix": ["aihubmix", "ark", "tos"],
  "script-remix-next": ["aihubmix", "tos"],
  "video-create": ["aihubmix", "ark", "tos"],
  "ad-script": ["aihubmix"],
  "ai-generate": ["aihubmix", "ark"],
  "video-cut": ["tos"],
  "media-understand": ["ark", "tos"],
  "video-mashup": ["tos"],
  "voice-clone": ["qwen-audio", "tos"],
  "video-renewal": ["aihubmix"],
  "subtitle-erase": ["mediakit", "tos"],
  "video-enhancement": ["mediakit", "tos"],
  "video-extract": ["tos"],
  "video-editor": ["tos"],
  kickart: ["aihubmix"],
};

const providerLabels = Object.fromEntries(
  providerIds.map((providerId) => [
    providerId,
    providerCredentialCatalog.find((credential) => credential.providerId === providerId)?.provider ?? providerId,
  ]),
) as Record<ProviderId, string>;

export function providerFeatureAvailability(
  requiredProviders: ProviderId[],
  isVerified: (providerId: ProviderId) => boolean = (providerId) => providerCredentials.isProviderVerified(providerId),
): FeatureAvailability {
  const unavailableProviders = requiredProviders.filter((providerId) => !isVerified(providerId));
  return {
    enabled: unavailableProviders.length === 0,
    requiredProviders,
    unavailableProviders,
    disabledReason: unavailableProviders.length
      ? `请先在管理后台检测并通过：${unavailableProviders.map((providerId) => providerLabels[providerId]).join("、")}`
      : undefined,
  };
}

export function moduleFeatureAvailability(moduleId: ModuleId, isVerified?: (providerId: ProviderId) => boolean) {
  return providerFeatureAvailability(moduleProviderRequirements[moduleId], isVerified);
}

export function allProviderFeatureAvailability(isVerified?: (providerId: ProviderId) => boolean) {
  return {
    modules: Object.fromEntries(
      Object.keys(moduleProviderRequirements).map((moduleId) => [
        moduleId,
        moduleFeatureAvailability(moduleId as ModuleId, isVerified),
      ]),
    ) as Record<ModuleId, FeatureAvailability>,
    operations: {
      assetUpload: providerFeatureAvailability(["tos"], isVerified),
      shareImport: providerFeatureAvailability(["tos"], isVerified),
      portraitCreation: providerFeatureAvailability(["ark", "tos"], isVerified),
      voiceSynthesis: providerFeatureAvailability(["volc-speech"], isVerified),
    },
  };
}
