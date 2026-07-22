export const remixPromptTools = ["check", "modify", "voice"] as const;
export type RemixPromptTool = (typeof remixPromptTools)[number];

export const remixPromptScopes = ["cross-script", "single-script"] as const;
export type RemixPromptScope = (typeof remixPromptScopes)[number];

export const remixReferenceModes = ["anchor", "chain"] as const;
export type RemixReferenceMode = (typeof remixReferenceModes)[number];

export const remixCheckTypes = [
  "action-direction",
  "background-scene",
  "environment-light",
  "character-traits",
  "product-props",
  "platform-policy",
] as const;
export type RemixCheckType = (typeof remixCheckTypes)[number];

export const remixRepairRules = ["preserve-at", "product-action-only", "preserve-voiceover"] as const;
export type RemixRepairRule = (typeof remixRepairRules)[number];

export const remixModifyPresetIds = ["beauty-soft", "beauty-strong", "product-replace"] as const;
export type RemixModifyPresetId = (typeof remixModifyPresetIds)[number];

export const remixVoiceModes = ["correct", "replace"] as const;
export type RemixVoiceMode = (typeof remixVoiceModes)[number];

export interface RemixPromptToolConfig {
  scope: RemixPromptScope;
  referenceMode: RemixReferenceMode;
  checkTypes: RemixCheckType[];
  repairRules: RemixRepairRule[];
  customInstruction: string;
  preset: RemixModifyPresetId | "";
  voiceMode: RemixVoiceMode;
}

export const remixModifyPresets: ReadonlyArray<{
  id: RemixModifyPresetId;
  title: string;
  description: string;
  instruction: string;
}> = [
  {
    id: "beauty-soft",
    title: "美妆人脸美白水光",
    description: "弱化人物 AI 感，对人物进行自然美白与皮肤水光透亮处理，适配美妆、护肤类产品口播视频场景。",
    instruction: "弱化人物 AI 感，对人物进行自然美白与皮肤水光透亮处理；保持五官、身份和真实肤质细节。",
  },
  {
    id: "beauty-strong",
    title: "人脸美白",
    description: "弱化人物 AI 质感，强效提亮肤色，打造通透自然美白效果，适配口播出镜场景。",
    instruction: "弱化人物 AI 质感并明显提亮肤色，保持自然通透、真实皮肤纹理和人物身份一致。",
  },
  {
    id: "product-replace",
    title: "商品替换",
    description: "清理原商品冗余描述，结合新款商品形态与使用方式，同步替换脚本内对应的商品实操动作。",
    instruction: "清理旧商品冗余描述，以当前绑定商品为唯一事实来源，替换商品形态、卖点与对应实操动作。",
  },
];

export const defaultRemixPromptToolConfig: RemixPromptToolConfig = {
  scope: "cross-script",
  referenceMode: "anchor",
  checkTypes: [...remixCheckTypes],
  repairRules: [...remixRepairRules],
  customInstruction: "",
  preset: "",
  voiceMode: "correct",
};

export const remixPromptToolLabels: Record<RemixPromptTool, string> = {
  check: "智能检查",
  modify: "智能修改",
  voice: "换口播",
};
