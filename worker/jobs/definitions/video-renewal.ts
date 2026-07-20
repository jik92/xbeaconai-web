import type { JobDefinition } from "./types";

export const videoRenewalDefinition: JobDefinition = {
  moduleId: "video-renewal",
  stages: [
    ["issue-detect", "问题检测"],
    ["video-restore", "视频修复"],
  ],
  summary: "视频问题已检测并生成修复版本。",
  outputKind: () => "video",
};
