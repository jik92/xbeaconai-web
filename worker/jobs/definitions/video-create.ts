import type { JobDefinition } from "./types";

export const videoCreateDefinition: JobDefinition = {
  moduleId: "video-create",
  stages: [
    ["text-generate", "脚本生成"],
    ["asset-match", "素材匹配"],
    ["speech-synthesize", "智能配音"],
    ["subtitle-align", "字幕对齐"],
    ["media-compose", "智能成片"],
  ],
  summary: "完整成片已生成，包含配音、字幕和转场。",
  outputKind: () => "video",
};
