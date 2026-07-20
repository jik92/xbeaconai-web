import type { JobDefinition } from "./types";

export const mediaUnderstandDefinition: JobDefinition = {
  moduleId: "media-understand",
  stages: [
    ["media-probe", "媒体探测"],
    ["media-understand", "内容理解"],
    ["timeline-label", "时间轴标签"],
  ],
  summary: "素材人物、场景、对白、商品与情绪标签已生成。",
  outputKind: () => "text",
};
