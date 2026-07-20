import type { JobRecord } from "../../server/types";
import { genericCreationJob } from "./job-generic-creation";
import { videoClipMergeJob } from "./job-video-clip-merge";
import { videoCutJob } from "./job-video-cut";
import { videoRemixAnalysisJob } from "./job-video-remix-analysis";
import type { WorkerJobHandler } from "./types";

export const jobHandlers: readonly WorkerJobHandler[] = [
  videoRemixAnalysisJob,
  videoClipMergeJob,
  videoCutJob,
  genericCreationJob,
];

export function findJobHandler(job: JobRecord): WorkerJobHandler {
  const handler = jobHandlers.find((candidate) => candidate.supports(job));
  if (!handler) throw new Error(`没有可执行 ${job.moduleId} 的 Worker Job Handler`);
  return handler;
}
