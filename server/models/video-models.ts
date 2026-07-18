export const seedanceModelIds = [
  "doubao-seedance-2-0-260128",
  "doubao-seedance-2-0-mini-260615",
  "doubao-seedance-2-0-fast-260128",
] as const;

export type SeedanceModelId = typeof seedanceModelIds[number];
export type SeedanceReferenceKind = "image" | "video" | "audio";

export interface VideoModelDefinition {
  id: SeedanceModelId;
  name: string;
  description: string;
  tags: string[];
  provider: "aihubmix";
  capability: "video-generate";
  referenceCapabilities: SeedanceReferenceKind[];
  defaults: { resolution: "720p"; ratio: "16:9"; duration: 5; generateAudio: true; watermark: false };
  isDefault: boolean;
}

export const videoModels: readonly VideoModelDefinition[] = [
  {
    id: "doubao-seedance-2-0-260128",
    name: "字节 Seedance 2.0 多模态参考",
    description: "音视图文均可参考，强调超强参考一致性和极致拟真的视听稳定性。",
    tags: ["高一致性", "视听稳定"], provider: "aihubmix", capability: "video-generate",
    referenceCapabilities: ["image", "video", "audio"],
    defaults: { resolution: "720p", ratio: "16:9", duration: 5, generateAudio: true, watermark: false },
    isDefault: false,
  },
  {
    id: "doubao-seedance-2-0-mini-260615",
    name: "字节 Seedance 2.0 Mini",
    description: "音视图文均可参考，新一代高性价比视频生成模型。",
    tags: ["高性价比", "规模生成"], provider: "aihubmix", capability: "video-generate",
    referenceCapabilities: ["image", "video", "audio"],
    defaults: { resolution: "720p", ratio: "16:9", duration: 5, generateAudio: true, watermark: false },
    isDefault: false,
  },
  {
    id: "doubao-seedance-2-0-fast-260128",
    name: "字节 Seedance 2.0 Fast",
    description: "音视图文均可参考，速度更快，并继承 Seedance 2.0 的核心优势。",
    tags: ["速度更快", "默认推荐"], provider: "aihubmix", capability: "video-generate",
    referenceCapabilities: ["image", "video", "audio"],
    defaults: { resolution: "720p", ratio: "16:9", duration: 5, generateAudio: true, watermark: false },
    isDefault: true,
  },
] as const;

export const defaultVideoModelId: SeedanceModelId = "doubao-seedance-2-0-fast-260128";
const modelIdSet = new Set<string>(seedanceModelIds);
export const isSeedanceModelId = (value: unknown): value is SeedanceModelId => typeof value === "string" && modelIdSet.has(value);
export const getVideoModel = (id: SeedanceModelId) => videoModels.find((model) => model.id === id)!;
