import type { ModuleId } from "@/entities/types";

export type CreationWorkflowId = "video-remix" | "video-create" | "ad-script";
export type AiToolboxId = Exclude<ModuleId, CreationWorkflowId>;
export type AssetFeatureId = "materials" | "portraits" | "products" | "voices";

export interface MenuFeatureConfig {
  readonly creationWorkflow: Readonly<Record<CreationWorkflowId, boolean>>;
  readonly aiToolbox: Readonly<Record<AiToolboxId, boolean>>;
  readonly assets: Readonly<Record<AssetFeatureId, boolean>>;
}

export interface PublicAppConfig {
  readonly projectName: string;
  readonly menuFeatures: MenuFeatureConfig;
}

/**
 * 项目名称和全部菜单功能开关只需在这里调整。
 * true = 开放；false = Coming Soon。
 */
export const APP_CONFIG = {
  projectName: "烽火AI",
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
      "video-mashup": false,
      "voice-clone": true,
      "video-renewal": false,
      "subtitle-erase": false,
      "video-enhancement": false,
      kickart: false,
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
} as const satisfies Record<ModuleId, "creationWorkflow" | "aiToolbox">;

export function isModuleOpen(moduleId: ModuleId, config: PublicAppConfig = APP_CONFIG): boolean {
  const group = MODULE_GROUP[moduleId];
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
