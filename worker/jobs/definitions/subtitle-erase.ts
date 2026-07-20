import type { JobDefinition } from "./types";

export const subtitleEraseDefinition: JobDefinition = {
  moduleId: "subtitle-erase",
  stages: [
    ["region-track", "区域跟踪"],
    ["region-inpaint", "擦除补全"],
  ],
  summary: "字幕区域已跟踪并完成背景补全。",
  outputKind: () => "video",
};
