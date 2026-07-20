import type { AccountStore } from "../../server/accounts/account-store";
import type { SqliteJobStore } from "../../server/jobs/sqlite-job-store";
import type { JobRecord } from "../../server/types";

export interface JobHandlerContext {
  readonly store: SqliteJobStore;
  readonly accounts?: AccountStore;
  change(id: string, patch: Partial<JobRecord>): JobRecord | undefined;
}

export interface WorkerJobHandler {
  readonly name: string;
  supports(job: JobRecord): boolean;
  execute(job: JobRecord, context: JobHandlerContext): Promise<void>;
}
