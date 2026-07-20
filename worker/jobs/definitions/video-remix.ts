import type { JobDefinition } from "./types";

export const videoRemixDefinition: JobDefinition = {
  moduleId: "video-remix",
  stages: [
    ["media-probe", "素材校验"],
    ["video-understand", "AI 解析"],
    ["text-rewrite", "提示词改写"],
    ["storyboard", "分镜生成"],
    ["video-generate", "画面生成"],
    ["media-compose", "合并成片"],
  ],
  summary: "二创视频已完成，保留原片结构并生成了新的口播与镜头。",
  outputKind: () => "video",
};
