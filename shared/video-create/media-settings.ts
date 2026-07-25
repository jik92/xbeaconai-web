import { type VoicePresetId, voicePresetCatalog } from "../voice/preset-voices";

export const videoCreateVoiceSpeeds = ["slow", "normal", "fast"] as const;
export type VideoCreateVoiceSpeed = (typeof videoCreateVoiceSpeeds)[number];

export const videoCreateVoiceStyles = ["marketing", "news", "entertainment"] as const;
export type VideoCreateVoiceStyle = (typeof videoCreateVoiceStyles)[number];

export interface VideoCreateVoiceSettings {
  presetVoiceId: VoicePresetId;
  speed: VideoCreateVoiceSpeed;
  style: VideoCreateVoiceStyle;
}

export const defaultVideoCreateVoiceSettings: VideoCreateVoiceSettings = {
  presetVoiceId: voicePresetCatalog[0].id,
  speed: "normal",
  style: "marketing",
};

export const videoCreateVoiceSpeedOptions = [
  { id: "slow", label: "慢速", speechRate: -20 },
  { id: "normal", label: "正常", speechRate: 0 },
  { id: "fast", label: "快速", speechRate: 20 },
] as const;

export const videoCreateVoiceStyleOptions = [
  { id: "marketing", label: "广告营销", contextText: "使用有感染力、清晰自然的广告营销口吻进行表达。" },
  { id: "news", label: "新闻播报", contextText: "使用清晰、稳重、客观的新闻播报口吻进行表达。" },
  { id: "entertainment", label: "娱乐八卦", contextText: "使用轻快、生动、有亲和力的娱乐口吻进行表达。" },
] as const;

export const videoCreateSubtitlePresets = [
  {
    id: "source-white",
    name: "思源白字",
    description: "清晰白字，适合深色画面",
    previewClassName: "font-sans font-semibold text-white",
    forceStyle:
      "FontName=Douyin Sans,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=36",
  },
  {
    id: "source-yellow",
    name: "思源黄字",
    description: "高亮黄字，适合营销内容",
    previewClassName: "font-sans font-semibold text-yellow-300",
    forceStyle:
      "FontName=Douyin Sans,FontSize=18,PrimaryColour=&H0000E6FF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=36",
  },
  {
    id: "title-white",
    name: "标题白字",
    description: "加粗标题字，强调重点",
    previewClassName: "font-sans text-lg font-black tracking-wide text-white",
    forceStyle:
      "FontName=Douyin Sans,FontSize=22,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=38",
  },
  {
    id: "title-yellow",
    name: "标题黄字",
    description: "醒目标题字，突出卖点",
    previewClassName: "font-sans text-lg font-black tracking-wide text-yellow-300",
    forceStyle:
      "FontName=Douyin Sans,FontSize=22,Bold=1,PrimaryColour=&H0000E6FF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=38",
  },
  {
    id: "happy-white",
    name: "快乐白字",
    description: "轻快圆润，适合生活内容",
    previewClassName: "font-sans text-lg font-black text-white",
    forceStyle:
      "FontName=Douyin Sans,FontSize=20,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00604020,BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginV=36",
  },
  {
    id: "happy-orange",
    name: "快乐橙字",
    description: "活泼橙字，适合轻松表达",
    previewClassName: "font-sans text-lg font-black text-orange-400",
    forceStyle:
      "FontName=Douyin Sans,FontSize=20,Bold=1,PrimaryColour=&H000080FF,OutlineColour=&H00302010,BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginV=36",
  },
] as const;

export type VideoCreateSubtitleStyleId = (typeof videoCreateSubtitlePresets)[number]["id"];
export const defaultVideoCreateSubtitleStyleId: VideoCreateSubtitleStyleId = "source-yellow";

export function videoCreateVoiceSettingsKey(settings: VideoCreateVoiceSettings) {
  return `${settings.presetVoiceId}:${settings.speed}:${settings.style}`;
}

export function videoCreateVoiceSpeechRate(speed: VideoCreateVoiceSpeed) {
  return videoCreateVoiceSpeedOptions.find((option) => option.id === speed)?.speechRate ?? 0;
}

export function videoCreateVoiceContextText(style: VideoCreateVoiceStyle) {
  return videoCreateVoiceStyleOptions.find((option) => option.id === style)?.contextText ?? "";
}

export function getVideoCreateSubtitlePreset(id?: VideoCreateSubtitleStyleId) {
  return videoCreateSubtitlePresets.find((preset) => preset.id === id) ?? videoCreateSubtitlePresets[1];
}
