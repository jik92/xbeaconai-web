import type { JobDefinition } from "./types";

export const adScriptDefinition: JobDefinition = {
  moduleId: "ad-script",
  stages: [
    ["ad-script-generate", "初稿生成"],
    ["ad-script-score", "转化力评分"],
    ["ad-script-compliance", "广告合规检测"],
    ["ad-script-optimize", "多轮调优"],
  ],
  summary: "已完成口播脚本生成、评分、合规检测与多轮调优。",
  outputKind: () => "text",
};
