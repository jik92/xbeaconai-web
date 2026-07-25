import type { CreationModelCapability } from "./capabilities";

export type ImageModelId =
  | "gpt-image-1-mini"
  | "seedream-5-lite"
  | "seedream-4-5"
  | "seedream-4-0"
  | "nano-banana-2"
  | "nano-banana-pro"
  | "gpt-image-2-stable";

export type ImageProviderProtocol =
  | "openai-images"
  | "aihubmix-predictions"
  | "gemini-interactions"
  | "gemini-content";

export interface ImageModelDefinition {
  id: ImageModelId;
  providerModel: string;
  protocol: ImageProviderProtocol;
  capability: CreationModelCapability;
}

const commonRatios = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"];

const imageDimensions = {
  "1k": {
    "1:1": { width: 1024, height: 1024 },
    "4:3": { width: 1152, height: 864 },
    "3:4": { width: 864, height: 1152 },
    "16:9": { width: 1344, height: 768 },
    "9:16": { width: 768, height: 1344 },
    "3:2": { width: 1216, height: 832 },
    "2:3": { width: 832, height: 1216 },
    "21:9": { width: 1536, height: 640 },
  },
  "2k": {
    "1:1": { width: 2048, height: 2048 },
    "4:3": { width: 2304, height: 1728 },
    "3:4": { width: 1728, height: 2304 },
    "16:9": { width: 2688, height: 1536 },
    "9:16": { width: 1536, height: 2688 },
    "3:2": { width: 2432, height: 1664 },
    "2:3": { width: 1664, height: 2432 },
    "21:9": { width: 3072, height: 1280 },
  },
  "4k": {
    "1:1": { width: 4096, height: 4096 },
    "4:3": { width: 4096, height: 3072 },
    "3:4": { width: 3072, height: 4096 },
    "16:9": { width: 4096, height: 2304 },
    "9:16": { width: 2304, height: 4096 },
    "3:2": { width: 4096, height: 2731 },
    "2:3": { width: 2731, height: 4096 },
    "21:9": { width: 4096, height: 1755 },
  },
};

function capability(
  id: ImageModelId,
  displayName: string,
  description: string,
  options: {
    badges?: string[];
    isDefault?: boolean;
    ratios?: string[];
    resolutions: string[];
    maxOutputs?: number;
    minReferences?: number;
    maxReferences?: number;
  },
): CreationModelCapability {
  const dimensions = Object.fromEntries(
    options.resolutions.flatMap((resolution) => {
      const values = imageDimensions[resolution as keyof typeof imageDimensions];
      return values ? [[resolution, values]] : [];
    }),
  );
  return {
    id,
    kind: "image",
    displayName,
    description,
    badges: options.badges ?? ["真实"],
    enabled: true,
    executionMode: "real",
    isDefault: options.isDefault ?? false,
    supportedRatios: options.ratios ?? commonRatios,
    supportedResolutions: options.resolutions,
    supportedDurations: [],
    maxOutputs: options.maxOutputs ?? 1,
    supportsSeed: false,
    referenceModes: [],
    acceptedReferenceKinds: ["image"],
    minReferences: options.minReferences ?? 0,
    maxReferences: options.maxReferences ?? 12,
    pricing: { baseCredits: 70, perOutputCredits: 70 },
    dimensions,
  };
}

export const imageModelDefinitions: ImageModelDefinition[] = [
  {
    id: "gpt-image-1-mini",
    providerModel: "gpt-image-1-mini",
    protocol: "openai-images",
    capability: capability("gpt-image-1-mini", "GPT Image 1 Mini", "经济型图片生成与编辑模型", {
      isDefault: true,
      ratios: ["1:1", "3:2", "2:3"],
      resolutions: ["1k"],
      maxReferences: 12,
    }),
  },
  {
    id: "seedream-5-lite",
    providerModel: "doubao-seedream-5.0-lite",
    protocol: "aihubmix-predictions",
    capability: capability(
      "seedream-5-lite",
      "字节 Seedream 5.0 Lite",
      "更智能可控的创作，实时检索，更强的一致性保持",
      { resolutions: ["2k"], maxReferences: 12 },
    ),
  },
  {
    id: "seedream-4-5",
    providerModel: "doubao-seedream-4-5",
    protocol: "aihubmix-predictions",
    capability: capability(
      "seedream-4-5",
      "字节 Seedream 4.5",
      "新一代图像多模态，细节更准，多图融合更好，小字与小人脸更自然",
      { resolutions: ["2k"], maxReferences: 12 },
    ),
  },
  {
    id: "seedream-4-0",
    providerModel: "doubao-seedream-4-0",
    protocol: "aihubmix-predictions",
    capability: capability(
      "seedream-4-0",
      "字节 Seedream 4.0",
      "行业顶尖图像创作，文生图与编辑统一，最多支持 12 张关联图",
      { resolutions: ["1k", "2k"], maxReferences: 12 },
    ),
  },
  {
    id: "nano-banana-2",
    providerModel: "gemini-3.1-flash-image",
    protocol: "gemini-interactions",
    capability: capability("nano-banana-2", "Nano Banana 2", "高效极速创作，兼顾性价比并覆盖多国场景", {
      resolutions: ["1k", "2k", "4k"],
      maxReferences: 12,
    }),
  },
  {
    id: "nano-banana-pro",
    providerModel: "gemini-3-pro-image-preview",
    protocol: "gemini-content",
    capability: capability("nano-banana-pro", "Nano Banana Pro", "旗舰级专业创作，光影精准，支持高级编辑", {
      resolutions: ["1k", "2k", "4k"],
      maxReferences: 12,
    }),
  },
  {
    id: "gpt-image-2-stable",
    providerModel: "gpt-image-2",
    protocol: "openai-images",
    capability: capability("gpt-image-2-stable", "GPT Image 2.0 稳定版", "高质量图像编辑能力", {
      badges: ["真实", "稳定版"],
      ratios: ["1:1", "3:2", "2:3"],
      resolutions: ["1k"],
      minReferences: 1,
      maxReferences: 1,
    }),
  },
];

export function getImageModelDefinition(id: string) {
  return imageModelDefinitions.find((model) => model.id === id);
}
