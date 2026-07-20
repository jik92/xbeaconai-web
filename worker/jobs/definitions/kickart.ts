import type { JobDefinition } from "./types";

export const kickartDefinition: JobDefinition = {
  moduleId: "kickart",
  stages: [
    ["variant-plan", "裂变规划"],
    ["text-variants", "文案变体"],
    ["batch-render", "批量渲染"],
  ],
  summary: "裂变矩阵已生成，可对比和筛选版本。",
  outputKind: () => "video",
};
