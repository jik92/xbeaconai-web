import type { JobDefinition } from "./types";

export const videoEnhancementDefinition: JobDefinition = {
  moduleId: "video-enhancement",
  stages: [
    ["media-probe", "画质评估"],
    ["video-enhance", "画质增强"],
  ],
  summary: "视频清晰度、色彩与细节已增强。",
  outputKind: () => "video",
};
