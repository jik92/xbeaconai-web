import type { ModuleId } from "../src/entities/types";
import type { SeedanceModelId } from "./models/video-models";

export type JobStatus = "queued" | "processing" | "succeeded" | "partially_succeeded" | "failed" | "cancelled";
export type ExecutionMode = "real" | "local" | "mock";
export type OverallExecutionMode = ExecutionMode | "mixed";

export interface StageProvenance {
  id: string;
  capability: string;
  executionMode: ExecutionMode;
  implementation: string;
  provider?: string;
  model?: string;
  fallbackReason?: string;
  startedAt: string;
  completedAt?: string;
}

export interface JobResult {
  kind: string;
  title: string;
  summary: string;
  artifacts: Array<{
    id: string;
    name: string;
    mimeType: string;
    url?: string;
    text?: string;
    executionMode: OverallExecutionMode;
    lineage: StageProvenance[];
  }>;
  data?: { values: Record<string, string>; generatedAt: string; mock: boolean };
}

export interface JobRecord {
  id: string;
  ownerUserId: string;
  moduleId: ModuleId;
  title: string;
  status: JobStatus;
  progress: number;
  stage: string;
  overallExecutionMode: OverallExecutionMode;
  values: Record<string, string>;
  videoModel?: SeedanceModelId;
  executionPlan: StageProvenance[];
  provenance: StageProvenance[];
  result?: JobResult;
  error?: { code: string; message: string; retryable: boolean; requestId: string };
  parentJobId?: string;
  idempotencyKey?: string;
  cancelRequested: boolean;
  providerModel?: SeedanceModelId;
  providerTaskId?: string;
  providerStatus?: string;
  providerSubmittedAt?: string;
  providerDeadlineAt?: string;
  providerCancelState?: "none" | "requested" | "unsupported" | "failed";
  stagingKeys: string[];
  jobSchemaVersion: 1 | 2;
  createdAt: string;
  updatedAt: string;
}
