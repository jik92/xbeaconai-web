import type { JobDefinition } from "./types";

export const subtitleEraseDefinition: JobDefinition = {
  moduleId: "subtitle-erase",
  stages: [["subtitle-erase-pro", "精细擦除字幕"]],
  summary: "字幕区域已跟踪并完成背景补全。",
  outputKind: () => "video",
};
