import { Queue } from "bullmq";
import IORedis from "ioredis";
import { type ExecuteJobPayload, executeJobName, executeJobOptions } from "../../shared/jobs/queue-contract";
import { env } from "../env";

function createRedisConnection() {
  return new IORedis(env.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
}

export class BullJobQueue {
  private redis?: IORedis;
  private queue?: Queue<ExecuteJobPayload>;

  private client() {
    if (!this.redis) this.redis = createRedisConnection();
    if (!this.queue)
      this.queue = new Queue<ExecuteJobPayload>(env.redisQueueName, {
        connection: this.redis,
        defaultJobOptions: executeJobOptions,
      });
    return this.queue;
  }

  async enqueue(jobId: string) {
    await this.client().add(executeJobName, { jobId }, { jobId });
  }

  async remove(jobId: string) {
    const job = await this.client().getJob(jobId);
    if (job) await job.remove();
  }

  async state() {
    return this.client().getJobCounts("wait", "active", "delayed", "failed");
  }

  async close() {
    await this.queue?.close();
    await this.redis?.quit();
  }
}
