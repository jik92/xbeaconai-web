import type { JobDefinition } from "./types";

export const videoMashupDefinition: JobDefinition = {
  moduleId: "video-mashup",
  stages: [
    ["media-probe", "素材校验"],
    ["asset-arrange", "素材编排"],
    ["batch-render", "批量渲染"],
  ],
  summary: "混剪批次已完成，可预览并下载差异化版本。",
  outputKind: () => "video",
};
