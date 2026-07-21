import type { SharePlatformAdapter } from "./types";
import { douyinAdapter } from "./adapters/douyin";
import { kuaishouAdapter } from "./adapters/kuaishou";
import { youtubeAdapter } from "./adapters/youtube";
import { xAdapter } from "./adapters/x";

/** All registered platform adapters, ordered by priority. */
export const platformAdapters: readonly SharePlatformAdapter[] = [
  douyinAdapter,
  kuaishouAdapter,
  youtubeAdapter,
  xAdapter,
];

export { ShareContentParser } from "./parser";
export type { ShareCandidate, ShareDownloadResult, SharePlatformAdapter } from "./types";
