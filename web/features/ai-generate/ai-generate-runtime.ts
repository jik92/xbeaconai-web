import type { AppendMessage, ThreadMessageLike } from "@assistant-ui/react";
import type { CreateAiGenerateJobData, Job } from "@/api/generated/types.gen";
import type { AttachmentPickerConstraints } from "@/components/domain/attachment-picker";

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
  conversationId?: string;
  conversationName?: string;
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

export const UNCLASSIFIED_CONVERSATION_ID = "unclassified";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AiGenerateConversation {
  id: string;
  name: string;
  jobs: Job[];
}

type ReferenceCapability = {
  acceptedReferenceKinds?: string[];
};

function supportedMediaKinds(model?: ReferenceCapability) {
  return (model?.acceptedReferenceKinds ?? []).filter(
    (kind): kind is "image" | "video" => kind === "image" || kind === "video",
  );
}

export function referenceAccept(model?: ReferenceCapability) {
  return supportedMediaKinds(model)
    .map((kind) => `${kind}/*`)
    .join(",");
}

export function seedanceReferenceConstraints(model?: ReferenceCapability): AttachmentPickerConstraints | undefined {
  const kinds = supportedMediaKinds(model);
  if (!kinds.length) return undefined;
  const image = kinds.includes("image");
  const video = kinds.includes("video");
  return {
    summary: [
      ...(image ? ["图片：PNG、JPG、WEBP、GIF · ≤10MB · 最多9个"] : []),
      ...(video ? ["视频：MP4、MOV、WebM · ≤200MB · ≤15.2秒 · 最多3个"] : []),
      "参考素材总数最多12个",
    ],
    byKind: {
      ...(image ? { image: { maxBytes: 10 * 1024 * 1024, maxCount: 9 } } : {}),
      ...(video ? { video: { maxBytes: 200 * 1024 * 1024, maxDurationSec: 15.2, maxCount: 3 } } : {}),
    },
  };
}

export function supportsMediaReference(model: ReferenceCapability | undefined, mimeType: string) {
  return supportedMediaKinds(model).includes(mimeType.split("/", 1)[0] as "image" | "video");
}

export function resolveReferenceMode(kind: AiGenerateKind, referenceMode: string, supportedModes: string[]) {
  return kind === "video" ? referenceMode || supportedModes[0] || "" : "";
}

export function buildProfessionalPrompt(input: { script: string; environment: string; emphasis: string }) {
  return [
    input.script.trim() ? `脚本：${input.script.trim()}` : "",
    input.environment.trim() ? `环境与运镜：${input.environment.trim()}` : "",
    input.emphasis.trim() ? `强调点：${input.emphasis.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseProfessionalPrompt(prompt: string) {
  const fields = { script: "", environment: "", emphasis: "" };
  let found = false;
  for (const line of prompt.split("\n")) {
    if (line.startsWith("脚本：")) {
      fields.script = line.slice(3).trim();
      found = true;
    } else if (line.startsWith("环境与运镜：")) {
      fields.environment = line.slice(6).trim();
      found = true;
    } else if (line.startsWith("强调点：")) {
      fields.emphasis = line.slice(4).trim();
      found = true;
    }
  }
  return found ? fields : undefined;
}

export function validateModelReferenceCount(
  model: { minReferences?: number; maxReferences?: number },
  referenceCount: number,
) {
  const minReferences = model.minReferences ?? 0;
  const maxReferences = model.maxReferences ?? 12;
  if (referenceCount < minReferences) return `该模型至少需要 ${minReferences} 张参考图`;
  if (referenceCount > maxReferences) return `该模型最多支持 ${maxReferences} 张参考图`;
  return undefined;
}

export function countEffectiveReferences(
  explicitCount: number,
  parentJobId: string | undefined,
  revisionMode: AiGenerateRevisionMode,
) {
  return explicitCount || (parentJobId && revisionMode !== "new" ? 1 : 0);
}

export function referencesFromAppendMessage(message: AppendMessage): AiGenerateReference[] {
  const attachmentParts =
    "attachments" in message ? (message.attachments ?? []).flatMap((attachment) => attachment.content ?? []) : [];
  const references = [...message.content, ...attachmentParts].flatMap((part) => {
    if (part.type !== "data" || part.name !== "ai-generate-reference") return [];
    return [part.data as unknown as AiGenerateReference];
  });
  return [...new Map(references.map((reference) => [reference.id, reference])).values()];
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

export function buildAiGenerateRequest(draft: AiGenerateDraft, title: string): CreateAiGenerateJobData["body"] {
  const conversation =
    draft.conversationId && uuidPattern.test(draft.conversationId)
      ? {
          conversationId: draft.conversationId,
          ...(draft.conversationName ? { conversationName: draft.conversationName } : {}),
        }
      : {};
  const common = {
    kind: draft.kind,
    title,
    prompt: draft.prompt.trim(),
    modelId: draft.modelId,
    ratio: draft.ratio,
    resolution: draft.resolution,
    referenceAssetIds: draft.references.map((reference) => reference.id),
    revisionMode: draft.revisionMode,
    ...conversation,
    ...(draft.parentJobId ? { parentJobId: draft.parentJobId } : {}),
  };
  return draft.kind === "image"
    ? { ...common, kind: "image", count: draft.count }
    : {
        ...common,
        kind: "video",
        duration: draft.duration,
        referenceMode: draft.referenceMode,
      };
}

export function groupAiGenerateConversations(jobs: Job[]): AiGenerateConversation[] {
  const groups = new Map<string, AiGenerateConversation>();
  for (const job of jobs) {
    const id = job.values.conversationId || UNCLASSIFIED_CONVERSATION_ID;
    const name = job.values.conversationName || "未分类";
    const group = groups.get(id) ?? { id, name, jobs: [] };
    group.jobs.push(job);
    groups.set(id, group);
  }
  return [...groups.values()].sort((left, right) => {
    const leftLatest = left.jobs.reduce((latest, job) => (job.createdAt > latest ? job.createdAt : latest), "");
    const rightLatest = right.jobs.reduce((latest, job) => (job.createdAt > latest ? job.createdAt : latest), "");
    return rightLatest.localeCompare(leftLatest);
  });
}

export function parseJobReferences(job: Job): AiGenerateReference[] {
  const raw = job.values.referenceMetadata ?? job.values.references?.replace(/^assets:/, "");
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
