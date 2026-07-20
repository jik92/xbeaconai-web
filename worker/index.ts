import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { AccountStore } from "../server/accounts/account-store";
import { AdScriptStore } from "../server/ad-script/ad-script-store";
import { env } from "../server/env";
import { SqliteJobStore } from "../server/jobs/sqlite-job-store";
import { VideoCreateStore } from "../server/video-create/video-create-store";
import { type ExecuteJobPayload, executeJobName, executeJobOptions } from "../shared/jobs/queue-contract";
import { JobProcessor } from "./job-processor";
import { createWorkerRedisConnection } from "./redis";

const store = new SqliteJobStore();
const accounts = new AccountStore();
const adScripts = new AdScriptStore();
const videoCreates = new VideoCreateStore();
const processor = new JobProcessor(store, accounts, adScripts, videoCreates);
const recoveryRedis = new IORedis(env.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
const recoveryQueue = new Queue<ExecuteJobPayload>(env.redisQueueName, {
  connection: recoveryRedis,
  defaultJobOptions: executeJobOptions,
});

await processor.startMaintenance();
for (const job of store.recoverable()) {
  if (job.ownerUserId === "legacy" || (await recoveryQueue.getJob(job.id))) continue;
  if (job.providerStatus === "submitting" && !job.providerTaskId) {
    store.update(job.id, {
      status: "failed",
      stage: "上游提交状态未知",
      error: {
        code: "PROVIDER_SUBMISSION_UNKNOWN",
        message: "上游提交结果未知，需要人工核对以避免重复计费",
        retryable: false,
        requestId: crypto.randomUUID(),
      },
    });
    continue;
  }
  store.update(job.id, { status: "queued", stage: "等待恢复", progress: Math.min(job.progress, 95) });
  await recoveryQueue.add(executeJobName, { jobId: job.id }, { jobId: job.id });
}

const workerRedis = createWorkerRedisConnection();
const worker = new Worker<ExecuteJobPayload>(
  env.redisQueueName,
  async (job) => {
    await processor.process(job.data.jobId);
  },
  { connection: workerRedis, concurrency: env.workerConcurrency },
);

worker.on("failed", (job, error) => {
  const jobId = job?.data.jobId;
  if (!jobId) return;
  const current = store.get(jobId);
  if (!current || ["succeeded", "partially_succeeded", "failed", "cancelled"].includes(current.status)) return;
  store.update(jobId, {
    status: "failed",
    stage: "Worker 执行失败",
    error: {
      code: "WORKER_EXECUTION_FAILED",
      message: error.message,
      retryable: true,
      requestId: crypto.randomUUID(),
    },
  });
});
worker.on("error", (error) => console.error("BullMQ Worker error", error));

await worker.waitUntilReady();
console.log(`BullMQ worker ready: queue=${env.redisQueueName}, concurrency=${env.workerConcurrency}`);

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await worker.close();
  await workerRedis.quit();
  await recoveryQueue.close();
  await recoveryRedis.quit();
  store.close();
  accounts.close();
  adScripts.close();
  videoCreates.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
