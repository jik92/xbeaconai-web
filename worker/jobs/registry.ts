import type { JobRecord } from "../../server/types";
import { adScriptJob } from "./job-ad-script";
import { genericCreationJob } from "./job-generic-creation";
import { videoClipMergeJob } from "./job-video-clip-merge";
import { videoCreateJob } from "./job-video-create";
import { videoCutJob } from "./job-video-cut";
import { videoRemixAnalysisJob } from "./job-video-remix-analysis";
import { voiceCloneJob } from "./job-voice-clone";
import type { WorkerJobHandler } from "./types";

export const jobHandlers: readonly WorkerJobHandler[] = [
  adScriptJob,
  videoCreateJob,
  videoRemixAnalysisJob,
  videoClipMergeJob,
  videoCutJob,
  voiceCloneJob,
  genericCreationJob,
];

export function findJobHandler(job: JobRecord): WorkerJobHandler {
  const handler = jobHandlers.find((candidate) => candidate.supports(job));
  if (!handler) throw new Error(`没有可执行 ${job.moduleId} 的 Worker Job Handler`);
  return handler;
}
