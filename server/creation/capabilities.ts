import { type SeedanceModelId, videoModels } from "../models/video-models";
import { imageModelDefinitions } from "./image-models";

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
  minReferences: number;
  maxReferences: number;
  pricing: { baseCredits: number; perOutputCredits: number };
  dimensions?: Record<string, Record<string, { width: number; height: number }>>;
}

const imageModels = imageModelDefinitions.map((model) => model.capability);

export function creationCapabilities(
  videoEnabled: (id: SeedanceModelId) => boolean,
  videoExecutionMode: CreationExecutionMode = "real",
  imageEnabled = true,
): CreationModelCapability[] {
  const images = imageModels.map((model) =>
    model.executionMode === "real"
      ? {
          ...model,
          enabled: imageEnabled,
          disabledReason: imageEnabled ? undefined : "真实图片生成基线尚未验证",
        }
      : model,
  );
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
      minReferences: 0,
      maxReferences: 12,
      pricing: {
        baseCredits: model.id.includes("mini") ? 35 : model.id.includes("fast") ? 50 : 70,
        perOutputCredits: 0,
      },
    }),
  );
  return [...images, ...videos];
}

export function validateCreationValues(values: Record<string, string>, models: CreationModelCapability[]) {
  const kind = values.creationKind;
  if (kind !== "image" && kind !== "video") return "请选择创作类型";
  const model = models.find((item) => item.id === values.modelId && item.kind === kind);
  if (!model?.enabled) return "所选模型当前不可用";
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
