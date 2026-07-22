import { describe, expect, test } from "bun:test";
import { stopAllAdminJobs } from "../../server/jobs/admin-job-control";
import type { JobRecord } from "../../server/types";

function job(id: string, status: JobRecord["status"]): JobRecord {
  const createdAt = new Date().toISOString();
  return {
    id,
    ownerUserId: crypto.randomUUID(),
    moduleId: "video-cut",
    title: id,
    status,
    progress: status === "processing" ? 50 : 0,
    stage: status,
    overallExecutionMode: "local",
    values: {},
    executionPlan: [],
    provenance: [],
    cancelRequested: false,
    providerCancelState: "none",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("admin stop all jobs", () => {
  test("cancels queued jobs, requests active cancellation and remains idempotent", async () => {
    const jobs = new Map(
      [job("queued", "queued"), job("processing", "processing"), job("done", "succeeded")].map((item) => [
        item.id,
        item,
      ]),
    );
    const removed: string[] = [];
    const store = {
      recoverable: () => [...jobs.values()].filter((item) => ["queued", "processing"].includes(item.status)),
      update: (id: string, patch: Partial<JobRecord>) => {
        const current = jobs.get(id);
        if (!current) return undefined;
        const next = { ...current, ...patch };
        jobs.set(id, next);
        return next;
      },
    };
    const queue = { remove: async (id: string) => void removed.push(id) };

    expect(await stopAllAdminJobs(store, queue)).toEqual({
      matched: 2,
      queuedCancelled: 1,
      processingRequested: 1,
      failed: 0,
    });
    expect(removed).toEqual(["queued"]);
    expect(jobs.get("queued")).toMatchObject({ status: "cancelled", cancelRequested: true, stage: "已取消" });
    expect(jobs.get("processing")).toMatchObject({ status: "processing", cancelRequested: true, stage: "正在取消" });
    expect(jobs.get("done")?.status).toBe("succeeded");
    expect(await stopAllAdminJobs(store, queue)).toEqual({
      matched: 0,
      queuedCancelled: 0,
      processingRequested: 0,
      failed: 0,
    });
  });

  test("reports BullMQ removal failures after persisting cancellation", async () => {
    const queued = job("queue-failure", "queued");
    const store = {
      recoverable: () => [queued],
      update: (_id: string, patch: Partial<JobRecord>) => Object.assign(queued, patch),
    };
    const result = await stopAllAdminJobs(store, { remove: async () => Promise.reject(new Error("redis down")) });
    expect(result).toEqual({ matched: 1, queuedCancelled: 1, processingRequested: 0, failed: 1 });
    expect(queued.status).toBe("cancelled");
  });
});
