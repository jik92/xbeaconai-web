import type { JobDefinition } from "./types";

export const videoEditorDefinition: JobDefinition = {
  moduleId: "video-editor",
  stages: [
    ["remotion-render", "渲染视频"],
    ["tos-upload", "保存素材"],
  ],
  summary: "剪辑成片已渲染并保存到素材库。",
  outputKind: () => "video",
};
