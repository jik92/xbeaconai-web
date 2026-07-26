import { Queue } from "bullmq";
import IORedis from "ioredis";
import { classifyJobWorkload, type JobWorkload } from "../../shared/jobs/job-workload";
import {
  type ExecuteJobPayload,
  executeJobName,
  executeJobOptions,
  jobQueueName,
} from "../../shared/jobs/queue-contract";
import { env } from "../env";
import type { JobRecord } from "../types";

function createRedisConnection() {
  return new IORedis(env.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
}

export class BullJobQueue {
  private redis?: IORedis;
  private readonly queues = new Map<JobWorkload, Queue<ExecuteJobPayload>>();

  constructor(private readonly getJob: (jobId: string) => JobRecord | undefined) {}

  private client(workload: JobWorkload) {
    if (!this.redis) this.redis = createRedisConnection();
    let queue = this.queues.get(workload);
    if (!queue) {
      queue = new Queue<ExecuteJobPayload>(jobQueueName(env.redisQueueName, workload), {
        connection: this.redis,
        defaultJobOptions: executeJobOptions,
      });
      this.queues.set(workload, queue);
    }
    return queue;
  }

  async enqueue(jobId: string) {
    const job = this.getJob(jobId);
    if (!job) throw new Error(`JOB_NOT_FOUND: ${jobId}`);
    const workload = classifyJobWorkload(job);
    await this.client(workload).add(executeJobName, { jobId }, { jobId });
  }

  async remove(jobId: string) {
    await Promise.all(
      (["network", "ffmpeg"] as const).map(async (workload) => {
        const job = await this.client(workload).getJob(jobId);
        if (job) await job.remove();
      }),
    );
  }

  async state() {
    const counts = await Promise.all(
      (["network", "ffmpeg"] as const).map((workload) =>
        this.client(workload).getJobCounts("wait", "active", "delayed", "failed"),
      ),
    );
    return counts.reduce(
      (total, count) => ({
        wait: total.wait + count.wait,
        active: total.active + count.active,
        delayed: total.delayed + count.delayed,
        failed: total.failed + count.failed,
      }),
      { wait: 0, active: 0, delayed: 0, failed: 0 },
    );
  }

  async close() {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    await this.redis?.quit();
  }
}
