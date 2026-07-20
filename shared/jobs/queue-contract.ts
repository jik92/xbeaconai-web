import type { JobsOptions } from "bullmq";

export interface ExecuteJobPayload {
  jobId: string;
}

export const executeJobName = "execute";

export const executeJobOptions: JobsOptions = {
  attempts: 1,
  removeOnComplete: { age: 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
};
