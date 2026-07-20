import type { AccountStore } from "../server/accounts/account-store";
import type { SqliteJobStore } from "../server/jobs/sqlite-job-store";
import { ossutils } from "../server/storage/ossutils";
import type { JobRecord } from "../server/types";
import { findJobHandler } from "./jobs/registry";
import type { JobHandlerContext } from "./jobs/types";

export { buildExecutionPlan, stageMap } from "./jobs/job-generic-creation";

/** Coordinates persisted jobs. Business execution lives in worker/jobs/job-*.ts. */
export class JobProcessor {
  private readonly context: JobHandlerContext;

  constructor(
    readonly store: SqliteJobStore,
    readonly accounts?: AccountStore,
  ) {
    this.context = {
      store,
      accounts,
      change: (id, patch) => this.change(id, patch),
    };
  }

  async startMaintenance() {
    await this.recoverObjectCleanup();
  }

  private async recoverObjectCleanup() {
    for (const item of this.store.pendingObjectCleanup()) {
      try {
        await ossutils.markCleanupReady(item.object_key);
        await ossutils.deleteObject(item.object_key);
        this.store.completeObjectCleanup(item.object_key);
        const job = this.store.get(item.job_id);
        if (job) this.store.update(job.id, { stagingKeys: job.stagingKeys.filter((key) => key !== item.object_key) });
      } catch (error) {
        this.store.deferObjectCleanup(item.object_key, error, item.attempts);
      }
    }
  }

  private change(id: string, patch: Partial<JobRecord>) {
    return this.store.update(id, patch);
  }

  async process(id: string) {
    const job = this.store.get(id);
    if (!job || job.status === "cancelled") return;
    await findJobHandler(job).execute(job, this.context);
  }
}
