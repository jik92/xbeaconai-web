export const voicePresetCatalog = [
  { id: "zh_female_vv_uranus_bigtts", name: "Vivi", description: "自然灵动女声" },
  { id: "zh_male_liufei_uranus_bigtts", name: "刘飞", description: "温暖成熟男声" },
  { id: "zh_male_m191_uranus_bigtts", name: "云舟", description: "沉稳叙事男声" },
  { id: "zh_male_xuanyijieshuo_uranus_bigtts", name: "悬疑解说", description: "悬疑叙事男声" },
] as const;

export type VoicePresetId = (typeof voicePresetCatalog)[number]["id"];

export function isVoicePresetId(value: string): value is VoicePresetId {
  return voicePresetCatalog.some((voice) => voice.id === value);
}
