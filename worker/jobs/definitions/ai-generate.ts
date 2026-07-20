import type { JobDefinition } from "./types";

export const aiGenerateDefinition: JobDefinition = {
  moduleId: "ai-generate",
  stages: [
    ["prompt-understand", "理解指令"],
    ["multimodal-generate", "生成内容"],
  ],
  summary: "创作内容已按指令生成，可继续追问或创建变体。",
  outputKind: (values) => (values.type === "图片" ? "image" : values.type === "视频" ? "video" : "text"),
};
