import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { AccountStore } from "../server/accounts/account-store";
import { AdScriptStore } from "../server/ad-script/ad-script-store";
import { ProviderGenerationAuditStore } from "../server/audit/provider-generation-audit-store";
import { env } from "../server/env";
import { SqliteJobStore } from "../server/jobs/sqlite-job-store";
import { CustomPortraitStore } from "../server/portraits/custom-portrait-store";
import { VideoCreateStore } from "../server/video-create/video-create-store";
import { classifyJobWorkload, type JobWorkload } from "../shared/jobs/job-workload";
import { type ExecuteJobPayload, executeJobName, executeJobOptions, jobQueueName } from "../shared/jobs/queue-contract";
import { JobProcessor } from "./job-processor";
import { safelySyncProviderGenerationAudits } from "./jobs/provider-audit";
import { createWorkerRedisConnection } from "./redis";

const store = new SqliteJobStore();
const accounts = new AccountStore();
const adScripts = new AdScriptStore();
const videoCreates = new VideoCreateStore();
const providerAudits = new ProviderGenerationAuditStore();
const customPortraits = new CustomPortraitStore();
const processor = new JobProcessor(store, accounts, adScripts, videoCreates, providerAudits, customPortraits);
const recoveryRedis = new IORedis(env.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
const recoveryQueues = new Map<JobWorkload, Queue<ExecuteJobPayload>>(
  (["network", "ffmpeg"] as const).map((workload) => [
    workload,
    new Queue<ExecuteJobPayload>(jobQueueName(env.redisQueueName, workload), {
      connection: recoveryRedis,
      defaultJobOptions: executeJobOptions,
    }),
  ]),
);
const legacyRecoveryQueue = new Queue<ExecuteJobPayload>(env.redisQueueName, { connection: recoveryRedis });
const recoveryQueueFor = (workload: JobWorkload) => {
  const queue = recoveryQueues.get(workload);
  if (!queue) throw new Error(`WORKER_QUEUE_NOT_FOUND: ${workload}`);
  return queue;
};

await processor.startMaintenance();
for (const job of store.recoverable()) {
  if (job.ownerUserId === "legacy") continue;
  const recoveryQueue = recoveryQueueFor(classifyJobWorkload(job));
  if (await recoveryQueue.getJob(job.id)) continue;
  const legacyJob = await legacyRecoveryQueue.getJob(job.id);
  if (legacyJob) await legacyJob.remove().catch(() => undefined);
  if (job.providerStatus === "submitting" && !job.providerTaskId) {
    const failed = store.update(job.id, {
      status: "failed",
      stage: "上游提交状态未知",
      error: {
        code: "PROVIDER_SUBMISSION_UNKNOWN",
        message: "上游提交结果未知，需要人工核对以避免重复计费",
        retryable: false,
        requestId: crypto.randomUUID(),
      },
    });
    safelySyncProviderGenerationAudits(providerAudits, failed);
    continue;
  }
  store.update(job.id, { status: "queued", stage: "等待恢复", progress: Math.min(job.progress, 95) });
  await recoveryQueue.add(executeJobName, { jobId: job.id }, { jobId: job.id });
}

const workerRedis = {
  network: createWorkerRedisConnection(),
  ffmpeg: createWorkerRedisConnection(),
};
const workers = {
  network: new Worker<ExecuteJobPayload>(
    jobQueueName(env.redisQueueName, "network"),
    async (job) => processor.process(job.data.jobId),
    { connection: workerRedis.network, concurrency: env.networkWorkerConcurrency },
  ),
  ffmpeg: new Worker<ExecuteJobPayload>(
    jobQueueName(env.redisQueueName, "ffmpeg"),
    async (job) => processor.process(job.data.jobId),
    { connection: workerRedis.ffmpeg, concurrency: env.ffmpegWorkerConcurrency },
  ),
};

const handleFailure = (job: { data: ExecuteJobPayload } | undefined, error: Error) => {
  const jobId = job?.data.jobId;
  if (!jobId) return;
  const current = store.get(jobId);
  if (!current || ["succeeded", "partially_succeeded", "failed", "cancelled"].includes(current.status)) return;
  const failed = store.update(jobId, {
    status: "failed",
    stage: "Worker 执行失败",
    error: {
      code: "WORKER_EXECUTION_FAILED",
      message: error.message,
      retryable: true,
      requestId: crypto.randomUUID(),
    },
  });
  safelySyncProviderGenerationAudits(providerAudits, failed);
};
for (const [workload, worker] of Object.entries(workers)) {
  worker.on("failed", handleFailure);
  worker.on("error", (error) => console.error(`BullMQ ${workload} Worker error`, error));
}

await Promise.all([workers.network.waitUntilReady(), workers.ffmpeg.waitUntilReady()]);
console.log(
  `BullMQ workers ready: network=${jobQueueName(env.redisQueueName, "network")}/${env.networkWorkerConcurrency}, ffmpeg=${jobQueueName(env.redisQueueName, "ffmpeg")}/${env.ffmpegWorkerConcurrency}`,
);

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await Promise.all([workers.network.close(), workers.ffmpeg.close()]);
  await Promise.all([workerRedis.network.quit(), workerRedis.ffmpeg.quit()]);
  await Promise.all([...recoveryQueues.values()].map((queue) => queue.close()));
  await legacyRecoveryQueue.close();
  await recoveryRedis.quit();
  store.close();
  accounts.close();
  adScripts.close();
  videoCreates.close();
  providerAudits.close();
  customPortraits.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
