import type { AppendMessage, ThreadMessageLike } from "@assistant-ui/react";
import type { Job } from "@/api/generated/types.gen";

export interface MediaUnderstandSelection {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  durationSec?: number;
  thumbnailUrl?: string;
  url?: string;
  originalUrl?: string;
}

export interface MediaUnderstandReference extends MediaUnderstandSelection {
  label: string;
}

export interface MediaUnderstandResultData {
  jobId: string;
  status: Job["status"];
  progress: number;
  stage: string;
  executionMode: Job["overallExecutionMode"];
  error?: Job["error"];
  artifacts: NonNullable<Job["result"]>["artifacts"];
}

export function mediaUnderstandReferencesFromAppendMessage(message: AppendMessage): MediaUnderstandReference[] {
  const attachmentParts =
    "attachments" in message ? (message.attachments ?? []).flatMap((attachment) => attachment.content ?? []) : [];
  const references = [...message.content, ...attachmentParts].flatMap((part) => {
    if (part.type !== "data" || part.name !== "media-understand-reference") return [];
    return [part.data as unknown as MediaUnderstandReference];
  });
  return [...new Map(references.map((reference) => [reference.id, reference])).values()];
}

export function parseMediaUnderstandJobReferences(job: Job) {
  const raw = job.values.referenceMetadata;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as MediaUnderstandReference[];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is MediaUnderstandReference =>
          Boolean(item?.id && item.name && item.mimeType && typeof item.label === "string"),
        )
      : [];
  } catch {
    return [];
  }
}

export function mediaUnderstandJobsToThreadMessages(jobs: Job[]): ThreadMessageLike[] {
  return [...jobs]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .flatMap((job): ThreadMessageLike[] => {
      const references = parseMediaUnderstandJobReferences(job);
      return [
        {
          id: `${job.id}:user`,
          role: "user",
          createdAt: new Date(job.createdAt),
          content: [{ type: "text", text: job.values.prompt || job.title }],
          metadata: { custom: { jobId: job.id, references } },
        },
        {
          id: `${job.id}:assistant`,
          role: "assistant",
          createdAt: new Date(job.updatedAt),
          content: [
            {
              type: "data",
              name: "media-understand-result",
              data: {
                jobId: job.id,
                status: job.status,
                progress: job.progress,
                stage: job.stage,
                executionMode: job.overallExecutionMode,
                error: job.error,
                artifacts: job.result?.artifacts ?? [],
              } satisfies MediaUnderstandResultData,
            },
          ],
          metadata: { custom: { jobId: job.id } },
        },
      ];
    });
}

export function classifyMediaUnderstandSelection(
  incoming: MediaUnderstandSelection[],
  current: MediaUnderstandSelection[],
) {
  const unique = [...current];
  for (const asset of incoming) if (!unique.some((item) => item.id === asset.id)) unique.push(asset);
  const primary = unique[0];
  const references: MediaUnderstandSelection[] = [];
  const rejected: string[] = [];
  for (const asset of unique.slice(1)) {
    if (asset.mimeType.startsWith("image/") && references.length < 5) references.push(asset);
    else rejected.push(asset.name);
  }
  return { primary, references, rejected };
}

export function mediaUnderstandReferenceLabels(
  primary: MediaUnderstandSelection | undefined,
  references: MediaUnderstandSelection[],
) {
  const labels = new Map<string, string>();
  if (primary) labels.set(primary.id, "主素材");
  references.forEach((reference, index) => {
    labels.set(reference.id, `商品参考图 ${index + 1}`);
  });
  return labels;
}

export function buildMediaUnderstandSubmission<TModelId extends string, TReasoningEffort extends string>(input: {
  modelId: TModelId;
  reasoningEffort: TReasoningEffort;
  prompt: string;
  primary: MediaUnderstandSelection;
  references: MediaUnderstandSelection[];
}) {
  return {
    modelId: input.modelId,
    reasoningEffort: input.reasoningEffort,
    prompt: input.prompt.trim(),
    primaryAssetId: input.primary.id,
    referenceImageAssetIds: input.references.map((item) => item.id),
  };
}
