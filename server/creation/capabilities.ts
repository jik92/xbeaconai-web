import { type SeedanceModelId, videoModels } from "../models/video-models";

export type CreationKind = "image" | "video";
export type CreationExecutionMode = "real" | "mock";

export interface CreationModelCapability {
  id: string;
  kind: CreationKind;
  displayName: string;
  description: string;
  badges: string[];
  enabled: boolean;
  disabledReason?: string;
  executionMode: CreationExecutionMode;
  isDefault: boolean;
  supportedRatios: string[];
  supportedResolutions: string[];
  supportedDurations: number[];
  maxOutputs: number;
  supportsSeed: boolean;
  referenceModes: string[];
  acceptedReferenceKinds: string[];
  pricing: { baseCredits: number; perOutputCredits: number };
  dimensions?: Record<string, Record<string, { width: number; height: number }>>;
}

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
};

const imageModels: CreationModelCapability[] = [
  ["seedream-5-pro", "字节 Seedream 5.0 Pro", "精准图像编辑｜解锁图层自由", ["模型上新"]],
  ["seedream-5-lite", "字节 Seedream 5.0 Lite", "更智能可控的创作，实时检索，更强的一致性保持", []],
  ["seedream-4-5", "字节 Seedream 4.5", "新一代图像多模态，细节更准，多图融合更好，小字与小人脸更自然", []],
  ["seedream-4-0", "字节 Seedream 4.0", "行业顶尖图像创作，文生图与编辑统一，最多支持 15 张关联图", []],
  ["nano-banana-2", "Nano Banana 2", "高效极速创作，实时检索，兼顾性价比并覆盖多国场景", []],
  ["nano-banana-pro", "Nano Banana Pro", "旗舰级专业创作，光影精准，支持高级编辑", []],
  ["gpt-image-2-stable", "GPT Image 2.0 稳定版", "高质量图像创作与编辑能力", ["稳定版"]],
].map(([id, displayName, description, badges], index) => ({
  id: id as string,
  kind: "image" as const,
  displayName: displayName as string,
  description: description as string,
  badges: badges as string[],
  enabled: true,
  executionMode: "mock" as const,
  isDefault: index === 0,
  supportedRatios: ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"],
  supportedResolutions: ["1k", "2k"],
  supportedDurations: [],
  maxOutputs: 8,
  supportsSeed: true,
  referenceModes: [],
  acceptedReferenceKinds: ["image", "person"],
  pricing: { baseCredits: 70, perOutputCredits: 70 },
  dimensions: imageDimensions,
}));

export function creationCapabilities(
  videoEnabled: (id: SeedanceModelId) => boolean,
  videoExecutionMode: CreationExecutionMode = "real",
): CreationModelCapability[] {
  const videos = videoModels.map(
    (model, index): CreationModelCapability => ({
      id: model.id,
      kind: "video",
      displayName: model.name.replace(" 多模态参考", ""),
      description: model.description,
      badges: model.tags,
      enabled: videoEnabled(model.id),
      disabledReason: videoEnabled(model.id) ? undefined : "真实基线尚未验证",
      executionMode: videoExecutionMode,
      isDefault: index === 0,
      supportedRatios: ["adaptive", "1:1", "16:9", "4:3", "3:4", "9:16", "21:9"],
      supportedResolutions: ["480p", "720p"],
      supportedDurations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      maxOutputs: 1,
      supportsSeed: false,
      referenceModes: ["omni"],
      acceptedReferenceKinds: ["image", "video", "audio"],
      pricing: {
        baseCredits: model.id.includes("mini") ? 35 : model.id.includes("fast") ? 50 : 70,
        perOutputCredits: 0,
      },
    }),
  );
  return [...imageModels, ...videos];
}

export function validateCreationValues(values: Record<string, string>, models: CreationModelCapability[]) {
  const kind = values.creationKind;
  if (kind !== "image" && kind !== "video") return "请选择创作类型";
  const model = models.find((item) => item.id === values.modelId && item.kind === kind);
  if (!model || !model.enabled) return "所选模型当前不可用";
  if (!values.prompt?.trim()) return "请输入创意描述";
  if (!model.supportedRatios.includes(values.ratio)) return "所选模型不支持该画幅";
  if (!model.supportedResolutions.includes(values.resolution)) return "所选模型不支持该清晰度";
  const count = Number(values.count);
  if (!Number.isInteger(count) || count < 1 || count > model.maxOutputs) return "生成数量超出模型能力";
  if (kind === "video") {
    if (!model.referenceModes.includes(values.referenceMode)) return "所选模型不支持该参考模式";
    if (!model.supportedDurations.includes(Number(values.duration))) return "所选模型不支持该视频时长";
  }
  if (values.seed && !model.supportsSeed) return "所选模型不支持种子值";
  return undefined;
}

export function quoteCreation(values: Record<string, string>, models: CreationModelCapability[]) {
  const model = models.find((item) => item.id === values.modelId && item.kind === values.creationKind);
  if (!model) return 0;
  return model.pricing.baseCredits + Math.max(0, Number(values.count || 1) - 1) * model.pricing.perOutputCredits;
}
