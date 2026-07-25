export const qwenVoiceDialects = [
  "普通话",
  "广东话",
  "重庆话",
  "东北话",
  "甘肃话",
  "贵州话",
  "浙江话",
  "河北话",
  "河南话",
  "湖北话",
  "湖南话",
  "江西话",
  "宁波话",
  "宁夏话",
  "青岛话",
  "陕西话",
  "山西话",
  "山东话",
  "上海话",
  "四川话",
  "云南话",
] as const;

export const qwenVoiceStyles = ["标准播音风格", "广告配音风格", "情绪递进风格", "温柔治愈风格"] as const;
export const qwenVoiceSpeeds = ["慢速", "标准", "快速"] as const;

export type QwenVoiceDialect = (typeof qwenVoiceDialects)[number];
export type QwenVoiceStyle = (typeof qwenVoiceStyles)[number];
export type QwenVoiceSpeed = (typeof qwenVoiceSpeeds)[number];

export function qwenVoicePrefix(jobId: string) {
  return `v${jobId.replaceAll("-", "").toLowerCase().slice(0, 9)}`;
}

const styleInstructions: Record<QwenVoiceStyle, string> = {
  标准播音风格: "吐字清晰精准，节奏平稳，语气自然端正，不要过度夸张。",
  广告配音风格: "使用有感染力的广告配音表达，热情明快，重点词适度加强，保持自然可信。",
  情绪递进风格: "情绪从自然平稳逐步增强到兴奋有感染力，转折自然，不要突然喊叫。",
  温柔治愈风格: "使用温柔、亲切、治愈的表达，语速稍慢，停顿自然，保持轻松舒适。",
};

const speedInstructions: Record<QwenVoiceSpeed, string> = {
  慢速: "整体语速较慢，保留自然停顿。",
  标准: "整体语速适中，节奏自然。",
  快速: "整体语速较快，但保持吐字清晰。",
};

export function isQwenVoiceDialect(value: string): value is QwenVoiceDialect {
  return qwenVoiceDialects.some((dialect) => dialect === value);
}

export function isQwenVoiceStyle(value: string): value is QwenVoiceStyle {
  return qwenVoiceStyles.some((style) => style === value);
}

export function isQwenVoiceSpeed(value: string): value is QwenVoiceSpeed {
  return qwenVoiceSpeeds.some((speed) => speed === value);
}

export function qwenVoiceInstruction(dialect: QwenVoiceDialect, style: QwenVoiceStyle, speed: QwenVoiceSpeed) {
  const dialectInstruction =
    dialect === "普通话" ? "请用自然标准的普通话表达。" : `请用自然地道的${dialect}表达，不要使用普通话播音腔。`;
  return `${dialectInstruction}${styleInstructions[style]}${speedInstructions[speed]}`;
}
