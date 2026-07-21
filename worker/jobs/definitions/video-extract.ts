import type { JobDefinition } from "./types";

export const videoExtractDefinition: JobDefinition = {
  moduleId: "video-extract",
  stages: [
    ["video-download", "下载视频"],
    ["media-probe", "校验媒体"],
    ["tos-upload", "保存素材"],
  ],
  summary: "视频已提取并保存到素材库。",
  outputKind: () => "video",
};
