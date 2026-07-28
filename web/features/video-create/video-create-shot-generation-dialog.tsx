import { ArrowUp, FileAudio2, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  VideoCreateShotGenerationDraft,
  VideoCreateShotGenerationOptions,
  VideoCreateShotGenerationSubmitOptions,
} from "@/api/api-client";
import { AttachmentPicker, type AttachmentSelection } from "@/components/domain/attachment-picker";
import { AuthenticatedMedia } from "@/components/domain/authenticated-media";
import { ImagePreview } from "@/components/domain/media-preview";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import {
  buildVideoCreateShotGenerationPrompt,
  fitVideoCreateShotPlanDuration,
  type VideoCreateImageCategory,
  videoCreateReferenceKind,
  videoCreateReferenceRole,
} from "../../../shared/video-create/shot-generation";
import { videoCreateVideoModelOptions } from "./video-create-model-options";

type DraftAttachment = VideoCreateShotGenerationDraft["attachments"][number];

function referenceKind(mimeType: string) {
  return videoCreateReferenceKind(mimeType);
}

function referenceRole(mimeType: string) {
  const kind = referenceKind(mimeType);
  return videoCreateReferenceRole(kind ?? "audio");
}

function nextLabel(mimeType: string, attachments: DraftAttachment[]) {
  const kind = referenceKind(mimeType);
  const prefix = kind === "image" ? "Image" : kind === "video" ? "Video" : "Audio";
  let ordinal = 1;
  while (attachments.some((item) => item.label === `${prefix}${ordinal}`)) ordinal += 1;
  return `${prefix}${ordinal}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeVideoCreateAttachmentLabels(prompt: string, attachments: DraftAttachment[]) {
  const counts = { image: 0, video: 0, audio: 0 };
  const bindings = attachments.map((attachment, index) => {
    const kind = referenceKind(attachment.mimeType) ?? "audio";
    counts[kind] += 1;
    const prefix = kind === "image" ? "Image" : kind === "video" ? "Video" : "Audio";
    return { attachment, label: `${prefix}${counts[kind]}`, placeholder: `@__REFERENCE_${index}__` };
  });
  let normalizedPrompt = prompt;
  for (const binding of bindings) {
    normalizedPrompt = normalizedPrompt.replace(
      new RegExp(`@${escapeRegExp(binding.attachment.label)}(?!\\d)`, "gu"),
      binding.placeholder,
    );
  }
  for (const binding of bindings)
    normalizedPrompt = normalizedPrompt.replaceAll(binding.placeholder, `@${binding.label}`);
  return {
    prompt: normalizedPrompt,
    attachments: bindings.map(({ attachment, label }) => ({ ...attachment, label })),
  };
}

function AttachmentPreview({ attachment }: { attachment: DraftAttachment }) {
  if (attachment.source === "portrait")
    return <ImagePreview className="size-full object-cover" src={attachment.url} alt={attachment.name} />;
  if (attachment.mimeType.startsWith("audio/"))
    return (
      <span className="grid size-full place-items-center bg-canvas-soft text-muted">
        <FileAudio2 className="size-5" />
      </span>
    );
  return (
    <AuthenticatedMedia
      url={attachment.url}
      mimeType={attachment.mimeType}
      alt={attachment.name}
      controls={false}
      loadingText=""
      errorText="预览失败"
    />
  );
}

function renderPrompt(draft: VideoCreateShotGenerationDraft, attachments: DraftAttachment[], duration: number) {
  return buildVideoCreateShotGenerationPrompt({
    durationSec: duration,
    plan: fitVideoCreateShotPlanDuration(draft.generationPlan, duration),
    references: attachments.map(({ label, name, role, category }) => ({ label, name, role, category })),
  });
}

export function VideoCreateShotGenerationDialog({
  open,
  draft,
  settings,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean;
  draft?: VideoCreateShotGenerationDraft;
  settings: VideoCreateShotGenerationOptions;
  loading: boolean;
  onClose: () => void;
  onSubmit: (options: VideoCreateShotGenerationSubmitOptions) => Promise<void>;
}) {
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [model, setModel] = useState(settings.videoModel);
  const [ratio, setRatio] = useState(settings.ratio);
  const [resolution, setResolution] = useState(settings.resolution);
  const [duration, setDuration] = useState(5);
  const [generateAudio, setGenerateAudio] = useState(settings.generateAudio);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submitOptions = useMemo<VideoCreateShotGenerationSubmitOptions>(() => {
    const portrait = attachments.find((attachment) => attachment.source === "portrait");
    return {
      videoModel: model,
      ratio,
      resolution,
      generateAudio,
      prompt: prompt.trim(),
      duration,
      referenceMode: "omni",
      references: attachments.flatMap((attachment) =>
        attachment.source === "asset" && attachment.assetId
          ? [{ assetId: attachment.assetId, label: attachment.label, category: attachment.category }]
          : [],
      ),
      usePortrait: Boolean(portrait?.portraitReference),
      ...(portrait?.portraitReference
        ? { portrait: { reference: portrait.portraitReference, label: portrait.label, category: "人物" as const } }
        : {}),
    };
  }, [attachments, duration, generateAudio, model, prompt, ratio, resolution]);

  useEffect(() => {
    if (!open || !draft) return;
    setPrompt(draft.prompt);
    setAttachments(draft.attachments);
    setModel(settings.videoModel);
    setRatio(settings.ratio);
    setResolution(settings.resolution);
    setDuration(draft.duration);
    setGenerateAudio(settings.generateAudio);
    setSubmitting(false);
    setError("");
  }, [draft, open, settings]);

  const addAttachments = (selected: AttachmentSelection[]) => {
    const next = [...attachments];
    for (const asset of selected) {
      const kind = referenceKind(asset.mimeType);
      if (!kind) {
        setError(`Seedance 不支持素材类型 ${asset.mimeType}`);
        return;
      }
      if (next.some((item) => item.assetId === asset.id)) {
        setError(`${asset.name} 已经绑定`);
        return;
      }
      const kindCount = next.filter((item) => referenceKind(item.mimeType) === kind).length;
      const kindLimit = kind === "image" ? 9 : 3;
      if (kindCount >= kindLimit) {
        setError(`${kind}参考最多 ${kindLimit} 个`);
        return;
      }
      if (next.length >= 12) {
        setError("参考素材总数最多 12 个");
        return;
      }
      const label = nextLabel(asset.mimeType, next);
      const attachment: DraftAttachment = {
        source: "asset",
        assetId: asset.id,
        label,
        name: asset.name,
        mimeType: asset.mimeType,
        role: referenceRole(asset.mimeType),
        ...(kind === "image" ? { category: "商品" as const } : {}),
        url: asset.url ?? `/api/assets/${asset.id}/access`,
      };
      next.push(attachment);
    }
    const normalized = normalizeVideoCreateAttachmentLabels(prompt, next);
    setAttachments(normalized.attachments);
    if (draft) setPrompt(renderPrompt(draft, normalized.attachments, duration));
    setError("");
  };

  const removeAttachment = (attachment: DraftAttachment) => {
    const normalized = normalizeVideoCreateAttachmentLabels(
      prompt,
      attachments.filter((item) => item !== attachment),
    );
    setAttachments(normalized.attachments);
    if (draft) setPrompt(renderPrompt(draft, normalized.attachments, duration));
    setError("");
  };

  const setAttachmentCategory = (attachment: DraftAttachment, category: VideoCreateImageCategory) => {
    const next = attachments.map((item) => (item === attachment ? { ...item, category } : item));
    setAttachments(next);
    const previousCategory = attachment.category ?? "商品";
    setPrompt((current) =>
      current.replaceAll(`@${attachment.label}（${previousCategory}）`, `@${attachment.label}（${category}）`),
    );
    setError("");
  };

  const submit = async () => {
    if (!draft) return;
    if (prompt.trim().length < 20) {
      setError("最终提示词至少需要 20 个字");
      return;
    }
    const missing = attachments.find((attachment) => !prompt.includes(`@${attachment.label}`));
    if (missing) {
      setError(`提示词缺少 @${missing.label} 引用`);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(submitOptions);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "分镜视频任务提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !submitting && onClose()}>
      <DialogContent className="grid h-[calc(100vh-32px)] max-h-[900px] max-w-[min(1280px,calc(100vw-32px))] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-line px-6 py-4">
          <DialogTitle className="type-section-title">AI生成视频素材</DialogTitle>
        </DialogHeader>
        {loading || !draft ? (
          <div className="grid place-items-center type-body text-muted">
            <span className="flex items-center gap-2">
              <LoaderCircle className="animate-spin" /> 正在构建最终生成参数
            </span>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-4">
            <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 type-body text-body">
              <span className="shrink-0 rounded-md bg-warning/15 px-2 py-1 type-badge text-ink">口播</span>
              <span className="leading-relaxed">{draft.narration}</span>
            </div>
            <div className="grid min-h-[420px] flex-1 grid-cols-[112px_minmax(0,1fr)] overflow-hidden rounded-2xl border border-line bg-surface">
              <aside className="flex flex-col items-center gap-3 border-r border-line bg-canvas-soft p-3">
                {attachments.map((attachment) => (
                  <div
                    className="group relative w-full"
                    key={`${attachment.source}-${attachment.assetId ?? attachment.portraitId}`}
                  >
                    <div className="aspect-square w-full overflow-hidden rounded-xl border border-line bg-surface [&_img]:size-full [&_img]:object-cover [&_video]:size-full [&_video]:object-cover">
                      <AttachmentPreview attachment={attachment} />
                    </div>
                    <span className="mt-1 block truncate text-center type-helper text-muted">
                      @{attachment.label}
                      {attachment.category ? `（${attachment.category}）` : ""}
                    </span>
                    {referenceKind(attachment.mimeType) === "image" && (
                      <NativeSelect
                        className="mt-1 h-7 w-full px-1 type-helper"
                        value={attachment.category ?? "商品"}
                        aria-label={`${attachment.label} 图片分类`}
                        disabled={attachment.source === "portrait"}
                        onChange={(event) =>
                          setAttachmentCategory(attachment, event.target.value as VideoCreateImageCategory)
                        }
                      >
                        <option value="人物">人物</option>
                        <option value="商品">商品</option>
                      </NativeSelect>
                    )}
                    <Button
                      className="absolute right-1 top-1 size-7 opacity-0 group-hover:opacity-100"
                      variant="outline"
                      size="icon-sm"
                      aria-label={`移除 ${attachment.label}`}
                      onClick={() => removeAttachment(attachment)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <AttachmentPicker
                  multiple
                  accept="image/*,video/*,audio/*"
                  onSelect={addAttachments}
                  trigger={(openPicker) => (
                    <Button className="size-10 rounded-full" variant="outline" size="icon-sm" onClick={openPicker}>
                      <Plus />
                      <span className="sr-only">添加参考附件</span>
                    </Button>
                  )}
                />
              </aside>
              <textarea
                className="min-h-[420px] w-full resize-none bg-transparent p-5 type-body leading-relaxed text-ink outline-none"
                value={prompt}
                maxLength={10_000}
                aria-label="最终视频生成提示词"
                onChange={(event) => setPrompt(event.target.value)}
              />
            </div>
            <div className="grid gap-2 rounded-xl border border-line bg-canvas-soft p-3 type-helper text-muted sm:grid-cols-2">
              <span>执行模式：{draft.executionMode === "mock" ? "FFmpeg Mock" : "真实 Seedance API"}</span>
              <span>
                {generateAudio
                  ? "声音：保留生成视频原声，分镜配音将关闭"
                  : `后续配音：${draft.postProcessAudio.model} / ${draft.postProcessAudio.voice}`}
              </span>
            </div>
            <details className="rounded-xl border border-line bg-canvas-soft type-helper text-muted">
              <summary className="cursor-pointer px-3 py-2 type-body-strong text-ink">
                查看 API 提交参数与附件绑定（{attachments.length} 个）
              </summary>
              <pre className="max-h-56 overflow-auto border-t border-line p-3 leading-relaxed">
                {JSON.stringify(submitOptions, null, 2)}
              </pre>
            </details>
          </div>
        )}
        <DialogFooter className="flex-wrap items-center justify-between border-t border-line bg-surface px-6 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              value={model}
              disabled={!draft}
              onChange={(event) => setModel(event.target.value as typeof model)}
            >
              {videoCreateVideoModelOptions.map(([id, label]) => (
                <option value={id} key={id}>
                  {label}
                </option>
              ))}
            </NativeSelect>
            <Button variant="outline" disabled>
              全能参考
            </Button>
            <NativeSelect
              value={ratio}
              disabled={!draft}
              onChange={(event) => setRatio(event.target.value as typeof ratio)}
            >
              <option value="9:16">9:16</option>
              <option value="16:9">16:9</option>
              <option value="1:1">1:1</option>
            </NativeSelect>
            <NativeSelect
              value={resolution}
              disabled={!draft}
              onChange={(event) => setResolution(event.target.value as typeof resolution)}
            >
              <option value="480p">480P</option>
              <option value="720p">720P</option>
            </NativeSelect>
            <label className="flex h-9 items-center gap-2 rounded-md border border-line px-3 type-body text-ink">
              <input
                className="w-10 bg-transparent outline-none"
                type="number"
                min={4}
                max={15}
                value={duration}
                disabled={!draft}
                onChange={(event) => {
                  const nextDuration = Math.min(15, Math.max(4, Number(event.target.value) || 4));
                  setDuration(nextDuration);
                  if (draft) setPrompt(renderPrompt(draft, attachments, nextDuration));
                }}
              />
              秒
            </label>
            <div className="flex h-9 items-center gap-2 rounded-md border border-line px-3 type-body text-ink">
              {generateAudio ? "有声" : "无声"}
              <Switch checked={generateAudio} disabled={!draft} onCheckedChange={setGenerateAudio} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            {error && <span className="max-w-sm text-right type-helper text-error">{error}</span>}
            <Button
              className="size-11 rounded-full"
              size="icon-sm"
              disabled={!draft || submitting}
              onClick={() => void submit()}
            >
              {submitting ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}
              <span className="sr-only">确认提交生成视频</span>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
