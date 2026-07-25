export const aiToolModuleIds = [
  "ai-generate",
  "video-cut",
  "media-understand",
  "video-mashup",
  "voice-clone",
  "video-renewal",
  "subtitle-erase",
  "video-enhancement",
  "kickart",
] as const;

export type AiToolModuleId = (typeof aiToolModuleIds)[number];

const aiToolModuleIdSet = new Set<string>(aiToolModuleIds);

export function isAiToolModuleId(value: string): value is AiToolModuleId {
  return aiToolModuleIdSet.has(value);
}
