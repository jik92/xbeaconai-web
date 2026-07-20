export const voicePresetStyles = [
  { name: "自然", instruction: "" },
  { name: "纪录片", instruction: "以沉稳、克制、有画面感的纪录片旁白方式演绎，停顿自然，不要夸张。" },
  { name: "短视频", instruction: "以自然、热情、接地气的短视频解说方式演绎，重点词适度加强。" },
  { name: "哄睡", instruction: "以轻柔、温暖、低能量的哄睡方式演绎，句间停顿稍长。" },
] as const;

export type VoicePresetStyle = (typeof voicePresetStyles)[number]["name"];

export function isVoicePresetStyle(value: string): value is VoicePresetStyle {
  return voicePresetStyles.some((style) => style.name === value);
}

export function voicePresetStyleInstruction(value: VoicePresetStyle) {
  return voicePresetStyles.find((style) => style.name === value)?.instruction ?? "";
}
