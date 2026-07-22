import type { ModuleId } from "@/entities/types";

export type CreationWorkflowId = "video-remix" | "video-create" | "ad-script";
export type UtilityId = "video-extract" | "video-editor";
export type AiToolboxId = Exclude<ModuleId, CreationWorkflowId | UtilityId>;
export type AssetFeatureId = "materials" | "portraits" | "products" | "voices";

export interface MenuFeatureConfig {
  readonly creationWorkflow: Readonly<Record<CreationWorkflowId, boolean>>;
  readonly aiToolbox: Readonly<Record<AiToolboxId, boolean>>;
  readonly utilities: Readonly<Record<UtilityId, boolean>>;
  readonly assets: Readonly<Record<AssetFeatureId, boolean>>;
}

export interface PublicAppConfig {
  readonly projectName: string;
  readonly providerDefaults: {
    readonly openai: { readonly baseUrl: string; readonly videoAnalysisModel: string };
    readonly volcSpeech: {
      readonly baseUrl: string;
      readonly cloneResourceId: string;
      readonly ttsResourceId: string;
      readonly presetTtsResourceId: string;
      readonly pollIntervalMs: number;
      readonly pollTimeoutMs: number;
    };
    readonly tos: { readonly region: string; readonly endpoint: string; readonly bucket: string };
    readonly volcSms: { readonly smsAccount: string; readonly sign: string; readonly templateId: string };
  };
  readonly menuFeatures: MenuFeatureConfig;
}

/**
 * 项目名称和全部菜单功能开关只需在这里调整。
 * true = 开放；false = Coming Soon。
 */
export const APP_CONFIG = {
  projectName: "烽火AI",
  providerDefaults: {
    openai: {
      baseUrl: "https://aihubmix.com",
      videoAnalysisModel: "gemini-3.5-flash",
    },
    volcSpeech: {
      baseUrl: "https://openspeech.bytedance.com",
      cloneResourceId: "seed-icl-2.0",
      ttsResourceId: "seed-icl-2.0",
      presetTtsResourceId: "seed-tts-2.0",
      pollIntervalMs: 2_000,
      pollTimeoutMs: 180_000,
    },
    tos: {
      region: "cn-beijing",
      endpoint: "tos-cn-beijing.volces.com",
      bucket: "xbeacon",
    },
    volcSms: {
      smsAccount: "8c444a41",
      sign: "杭州絮缕科技",
      templateId: "SPT_09a29a26",
    },
  },
  menuFeatures: {
    creationWorkflow: {
      "video-remix": true,
      "video-create": true,
      "ad-script": true,
    },
    aiToolbox: {
      "ai-generate": false,
      "video-cut": true,
      "media-understand": false,
      "video-mashup": true,
      "voice-clone": true,
      "video-renewal": false,
      "subtitle-erase": true,
      "video-enhancement": true,
      kickart: false,
    },
    utilities: {
      "video-extract": true,
      "video-editor": false,
    },
    assets: {
      materials: true,
      portraits: true,
      products: true,
      voices: true,
    },
  },
} as const satisfies PublicAppConfig;

const MODULE_GROUP = {
  "video-remix": "creationWorkflow",
  "video-create": "creationWorkflow",
  "ad-script": "creationWorkflow",
  "ai-generate": "aiToolbox",
  "video-cut": "aiToolbox",
  "media-understand": "aiToolbox",
  "video-mashup": "aiToolbox",
  "voice-clone": "aiToolbox",
  "video-renewal": "aiToolbox",
  "subtitle-erase": "aiToolbox",
  "video-enhancement": "aiToolbox",
  kickart: "aiToolbox",
  "video-extract": "utilities",
  "video-editor": "utilities",
} as const satisfies Record<ModuleId, "creationWorkflow" | "aiToolbox" | "utilities">;

export function isModuleOpen(moduleId: ModuleId, config: PublicAppConfig = APP_CONFIG): boolean {
  const group = MODULE_GROUP[moduleId];
  if (group === "utilities") return config.menuFeatures.utilities[moduleId as UtilityId];
  return group === "creationWorkflow"
    ? config.menuFeatures.creationWorkflow[moduleId as CreationWorkflowId]
    : config.menuFeatures.aiToolbox[moduleId as AiToolboxId];
}

export function isAssetOpen(assetId: AssetFeatureId, config: PublicAppConfig = APP_CONFIG): boolean {
  return config.menuFeatures.assets[assetId];
}

export type HomeDestination = { kind: "route"; path: string } | { kind: "project-coming-soon" };

export function resolveHomeDestination(
  modules: ReadonlyArray<{ id: ModuleId; path: string }>,
  config: PublicAppConfig = APP_CONFIG,
): HomeDestination {
  const firstOpenModule = modules.find((item) => isModuleOpen(item.id, config));
  if (firstOpenModule) return { kind: "route", path: firstOpenModule.path };
  if (isAssetOpen("portraits", config)) return { kind: "route", path: "/assets/portraits" };
  return { kind: "project-coming-soon" };
}
