import type { JobDefinition } from "./types";

export const mediaUnderstandDefinition: JobDefinition = {
  moduleId: "media-understand",
  stages: [
    ["media-understand", "方舟理解素材"],
    ["shot-script-validate", "校验镜头脚本"],
  ],
  summary: "素材已理解，并生成结构化 JSON 镜头脚本。",
  outputKind: () => "text",
};
