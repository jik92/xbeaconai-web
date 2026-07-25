import type {
  ProviderAuditStatus,
  ProviderGenerationAuditStore,
} from "../../server/audit/provider-generation-audit-store";
import type { JobRecord } from "../../server/types";

function terminalAuditStatus(
  job: JobRecord,
): Extract<ProviderAuditStatus, "succeeded" | "failed" | "cancelled"> | undefined {
  if (job.status === "succeeded" || job.status === "partially_succeeded") return "succeeded";
  if (job.status === "failed") return "failed";
  if (job.status === "cancelled") return "cancelled";
  return undefined;
}

function operationName(job: JobRecord, stageId: string) {
  const prefix = `${job.id}:`;
  return stageId.startsWith(prefix) ? stageId.slice(prefix.length) : stageId;
}

/**
 * Reconciles persisted job provenance into administrator-facing Provider audits.
 * Provenance is authoritative for whether a stage used a real third-party Provider,
 * so local and mock work never appears as an external API call.
 */
export function syncProviderGenerationAudits(audits: ProviderGenerationAuditStore, job: JobRecord) {
  const providerStages = job.provenance.filter((stage) => stage.executionMode === "real");
  for (const stage of providerStages) {
    if (!stage.provider) continue;
    const audit = audits.begin({
      jobId: job.id,
      ownerUserId: job.ownerUserId,
      moduleId: job.moduleId,
      capability: stage.capability,
      provider: stage.provider,
      model: stage.model ?? job.providerModel ?? job.videoModel,
      operation: operationName(job, stage.id),
      requestPayload: job.values,
      submittedAt: job.providerSubmittedAt ?? stage.startedAt ?? job.createdAt,
    });
    const terminal = terminalAuditStatus(job);
    const providerRequestId = job.error?.requestId;
    if (!terminal) {
      audits.progress({
        auditId: audit.id,
        providerTaskId: job.providerTaskId,
        providerRequestId,
        status: "processing",
      });
      continue;
    }
    audits.complete({
      auditId: audit.id,
      status: terminal,
      providerTaskId: job.providerTaskId,
      providerRequestId,
      responsePayload: job.result
        ? {
            providerStatus: job.providerStatus,
            result: job.result,
          }
        : job.providerStatus
          ? { providerStatus: job.providerStatus }
          : undefined,
      errorPayload: job.error,
      assetIds: job.result?.artifacts.map((artifact) => artifact.id) ?? [],
      completedAt: stage.completedAt ?? job.updatedAt,
    });
  }
}

export function safelySyncProviderGenerationAudits(
  audits: ProviderGenerationAuditStore | undefined,
  job: JobRecord | undefined,
) {
  if (!audits || !job) return;
  try {
    syncProviderGenerationAudits(audits, job);
  } catch (error) {
    console.error("Provider generation audit persistence failed", {
      jobId: job.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
