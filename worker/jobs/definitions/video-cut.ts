import type { JobDefinition } from "./types";

export const videoCutDefinition: JobDefinition = {
  moduleId: "video-cut",
  stages: [
    ["media-probe", "媒体探测"],
    ["video-split", "智能切分"],
  ],
  summary: "视频已按所选策略切分为可复用片段。",
  outputKind: () => "video",
};
