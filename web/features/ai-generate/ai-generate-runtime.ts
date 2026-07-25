import type { ThreadMessageLike } from "@assistant-ui/react";
import type { Job, SeedanceModelId } from "@/api/generated/types.gen";

export type AiGenerateKind = "image" | "video";
export type AiGenerateRevisionMode = "new" | "edit" | "variant";

export interface AiGenerateReference {
  id: string;
  name: string;
  mimeType: string;
  label: string;
  source: "upload" | "library" | "portrait" | "result";
  size?: number;
  url?: string;
}

export interface AiGenerateDraft {
  kind: AiGenerateKind;
  prompt: string;
  modelId: string;
  ratio: string;
  resolution: string;
  count: number;
  duration: number;
  seed: string;
  referenceMode: string;
  references: AiGenerateReference[];
  parentJobId?: string;
  revisionMode: AiGenerateRevisionMode;
}

export interface AiGenerateResultData {
  jobId: string;
  status: Job["status"];
  progress: number;
  stage: string;
  executionMode: Job["overallExecutionMode"];
  error?: Job["error"];
  artifacts: NonNullable<Job["result"]>["artifacts"];
}

const mentionPattern = /@(图片|视频|音频|人像)\d+/g;

export function resolveAssetMentions(text: string, references: AiGenerateReference[]) {
  const labels = new Map(references.map((reference) => [`@${reference.label}`, reference]));
  const mentions = [...new Set(text.match(mentionPattern) ?? [])];
  return {
    references: mentions.length ? mentions.flatMap((mention) => labels.get(mention) ?? []) : references,
    unresolved: mentions.filter((mention) => !labels.has(mention)),
  };
}

export function buildAiGenerateValues(draft: AiGenerateDraft): Record<string, string> {
  return {
    type: draft.kind === "image" ? "图片" : "视频",
    creationKind: draft.kind,
    prompt: draft.prompt.trim(),
    modelId: draft.modelId,
    ratio: draft.ratio,
    resolution: draft.resolution,
    count: String(draft.count),
    duration: String(draft.duration),
    seed: draft.seed,
    referenceMode: draft.referenceMode,
    references: `assets:${JSON.stringify(draft.references)}`,
    revisionMode: draft.revisionMode,
    ...(draft.parentJobId ? { parentJobId: draft.parentJobId } : {}),
  };
}

export function videoModelForDraft(draft: AiGenerateDraft): SeedanceModelId | undefined {
  return draft.kind === "video" ? (draft.modelId as SeedanceModelId) : undefined;
}

export function parseJobReferences(job: Job): AiGenerateReference[] {
  const raw = job.values.references?.replace(/^assets:/, "");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as AiGenerateReference[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.label === "string") : [];
  } catch {
    return [];
  }
}

export function jobsToThreadMessages(jobs: Job[]): ThreadMessageLike[] {
  return [...jobs]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .flatMap((job): ThreadMessageLike[] => {
      const createdAt = new Date(job.createdAt);
      const references = parseJobReferences(job);
      return [
        {
          id: `${job.id}:user`,
          role: "user",
          createdAt,
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
              name: "ai-generate-result",
              data: {
                jobId: job.id,
                status: job.status,
                progress: job.progress,
                stage: job.stage,
                executionMode: job.overallExecutionMode,
                error: job.error,
                artifacts: job.result?.artifacts ?? [],
              } satisfies AiGenerateResultData,
            },
          ],
          metadata: { custom: { jobId: job.id } },
        },
      ];
    });
}
