import type { AccountStore } from "../../server/accounts/account-store";
import type { AdScriptStore } from "../../server/ad-script/ad-script-store";
import type { SqliteJobStore } from "../../server/jobs/sqlite-job-store";
import type { JobRecord } from "../../server/types";
import type { VideoCreateStore } from "../../server/video-create/video-create-store";

export interface JobHandlerContext {
  readonly store: SqliteJobStore;
  readonly accounts?: AccountStore;
  readonly adScripts?: AdScriptStore;
  readonly videoCreates?: VideoCreateStore;
  /** Injectable download function for integration testing. */
  readonly downloadFn?: (
    platformId: string,
    normalizedUrl: string,
    timeoutMs?: number,
  ) => Promise<{ filePath: string; tempDir: string; mimeType: string; byteSize: number }>;
  change(id: string, patch: Partial<JobRecord>): JobRecord | undefined;
}

export interface WorkerJobHandler {
  readonly name: string;
  supports(job: JobRecord): boolean;
  execute(job: JobRecord, context: JobHandlerContext): Promise<void>;
}
