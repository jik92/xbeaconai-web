import type { JobRecord } from "../types";

interface AdminJobStore {
  recoverable(): JobRecord[];
  update(id: string, patch: Partial<JobRecord>): JobRecord | undefined;
}

interface AdminJobQueue {
  remove(jobId: string): Promise<void>;
}

export interface StopAllJobsResult {
  matched: number;
  queuedCancelled: number;
  processingRequested: number;
  failed: number;
}

export async function stopAllAdminJobs(
  store: AdminJobStore,
  queue: AdminJobQueue,
  onQueuedCancelled: (job: JobRecord) => void = () => {},
): Promise<StopAllJobsResult> {
  const active = store.recoverable().filter((job) => job.status === "queued" || !job.cancelRequested);
  const result: StopAllJobsResult = {
    matched: active.length,
    queuedCancelled: 0,
    processingRequested: 0,
    failed: 0,
  };

  const removals: Promise<void>[] = [];
  for (const job of active) {
    if (job.status === "queued") {
      const cancelled = store.update(job.id, { status: "cancelled", cancelRequested: true, stage: "已取消" });
      if (!cancelled) {
        result.failed += 1;
        continue;
      }
      result.queuedCancelled += 1;
      try {
        onQueuedCancelled(job);
      } catch {
        result.failed += 1;
      }
      removals.push(
        queue.remove(job.id).catch(() => {
          result.failed += 1;
        }),
      );
      continue;
    }
    const requested = store.update(job.id, { cancelRequested: true, stage: "正在取消" });
    if (requested) result.processingRequested += 1;
    else result.failed += 1;
  }
  await Promise.all(removals);
  return result;
}
