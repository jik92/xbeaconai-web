import type { JobDefinition } from "./types";

export const adScriptDefinition: JobDefinition = {
  moduleId: "ad-script",
  stages: [
    ["text-generate", "脚本生成"],
    ["structured-output", "结构校验"],
  ],
  summary: "已生成三版不同开场的高转化口播脚本。",
  outputKind: () => "text",
};
