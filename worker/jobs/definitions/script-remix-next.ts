import type { JobDefinition } from "./types";

export const scriptRemixNextDefinition: JobDefinition = {
  moduleId: "script-remix-next",
  stages: [
    ["text-understand", "脚本解析"],
    ["image-generate", "分镜稿件"],
    ["video-generate", "分镜视频"],
    ["media-compose", "合并成片"],
  ],
  summary: "新版脚本二创已完成脚本解析、分镜稿件、分镜视频和合并成片。",
  outputKind: (values) =>
    values.workflowPhase === "analysis"
      ? "text"
      : values.workflowPhase === "compose" || values.workflowPhase === "shot-generation"
        ? "video"
        : "image",
};
