export type {
  VideoCreateImageCategory,
  VideoCreatePromptReference,
  VideoCreateReferenceKind,
  VideoCreateShotGenerationPlan,
  VideoCreateSubshotPlan,
} from "../../shared/video-create/shot-generation";
export {
  allocateVideoCreateSubshotDurations,
  buildVideoCreateShotGenerationPrompt,
  createFallbackVideoCreateShotPlan,
  fitVideoCreateShotPlanDuration,
  nextVideoCreateReferenceLabel,
  splitVideoCreateSubshotText,
  videoCreateReferenceKind,
  videoCreateReferenceRole,
} from "../../shared/video-create/shot-generation";

import type { VideoCreateImageCategory, VideoCreateReferenceKind } from "../../shared/video-create/shot-generation";
import { videoCreateReferenceKind } from "../../shared/video-create/shot-generation";

export interface VideoCreateOwnedReference {
  id: string;
  label: string;
  mimeType: string;
  byteSize: number;
  category?: VideoCreateImageCategory;
}

export function validateVideoCreateShotGenerationReferences(input: {
  prompt: string;
  references: VideoCreateOwnedReference[];
  portraitLabel?: string;
  portraitCategory?: VideoCreateImageCategory;
}) {
  if (input.prompt.trim().length < 20 || input.prompt.length > 10_000) return "最终提示词长度必须为 20～10000 字";
  if (input.references.length + (input.portraitLabel ? 1 : 0) > 12) return "参考素材总数最多 12 个";
  const ids = new Set<string>();
  const labels = new Set<string>();
  const counts = new Map<VideoCreateReferenceKind, number>();
  let totalBytes = 0;
  if (input.portraitLabel) {
    if (input.portraitLabel !== "Image1") return "人像参考必须绑定为 @Image1";
    if (input.portraitCategory !== "人物") return "人像参考必须分类为人物";
    if (!input.prompt.includes(`@${input.portraitLabel}（人物）`))
      return `提示词缺少 @${input.portraitLabel}（人物）引用`;
    counts.set("image", 1);
    labels.add(input.portraitLabel);
  }
  for (const reference of input.references) {
    if (ids.has(reference.id)) return "参考素材不能重复";
    ids.add(reference.id);
    if (labels.has(reference.label)) return "参考素材标签不能重复";
    labels.add(reference.label);
    if (!/^[-_\p{L}\p{N}]{1,20}$/u.test(reference.label)) return "参考素材标签格式无效";
    const kind = videoCreateReferenceKind(reference.mimeType);
    if (!kind) return `Seedance 不支持素材类型 ${reference.mimeType}`;
    if (kind === "image" && reference.category !== "人物" && reference.category !== "商品")
      return "图片参考必须分类为人物或商品";
    if (kind !== "image" && reference.category) return "只有图片参考可以设置人物或商品分类";
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    const count = counts.get(kind) ?? 0;
    const countLimit = kind === "image" ? 9 : 3;
    if (count > countLimit) return `${kind}参考最多 ${countLimit} 个`;
    const expectedLabel = `${kind === "image" ? "Image" : kind === "video" ? "Video" : "Audio"}${count}`;
    if (reference.label !== expectedLabel) return `${kind}参考标签必须按顺序绑定为 @${expectedLabel}`;
    const byteLimit = kind === "image" ? 10 * 1024 * 1024 : kind === "video" ? 200 * 1024 * 1024 : 50 * 1024 * 1024;
    if (reference.byteSize > byteLimit) return `${kind}参考超过大小限制`;
    totalBytes += reference.byteSize;
    const referenceToken = `@${reference.label}${reference.category ? `（${reference.category}）` : ""}`;
    if (!input.prompt.includes(referenceToken)) return `提示词缺少 ${referenceToken} 引用`;
  }
  if (totalBytes > 250 * 1024 * 1024) return "参考素材总量超过限制";
  const tokens = input.prompt.match(/@(Image|Video|Audio|图片|视频|音频|人像)\d+/gu) ?? [];
  const unresolved = tokens.find((token) => !labels.has(token.slice(1)));
  return unresolved ? `${unresolved} 未绑定到提交附件` : undefined;
}
