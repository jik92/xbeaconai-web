import {
  ActionBarPrimitive,
  type AppendMessage,
  AssistantRuntimeProvider,
  AttachmentPrimitive,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  type ThreadMessageLike,
  ThreadPrimitive,
  type Unstable_DirectiveFormatter,
  type Unstable_DirectiveSegment,
  unstable_useMentionAdapter,
  useAui,
  useAuiState,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, Download, Image, Library, LoaderCircle, RefreshCw, Send, Sparkles, Video, X } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { downloadAuthenticated, fetchCreationCapabilities, fetchJobs, submitAiGenerateJob } from "@/api/api-client";
import type { Job } from "@/api/generated/types.gen";
import { AttachmentPicker, type AttachmentSelection } from "@/components/domain/attachment-picker";
import { MediaPreview } from "@/components/domain/media-preview";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { randomUuid } from "@/lib/random-id";
import type { CreationModelCapability } from "../ai-creation/ai-creation-composer";
import {
  type AiGenerateDraft,
  type AiGenerateKind,
  type AiGenerateReference,
  type AiGenerateResultData,
  buildAiGenerateRequest,
  countEffectiveReferences,
  jobsToThreadMessages,
  parseJobReferences,
  resolveAssetMentions,
  validateModelReferenceCount,
} from "./ai-generate-runtime";

type RuntimeContextValue = {
  jobs: Job[];
  draft: AiGenerateDraft;
  models: CreationModelCapability[];
  setDraft: React.Dispatch<React.SetStateAction<AiGenerateDraft>>;
};

const RuntimeContext = createContext<RuntimeContextValue | null>(null);
const assetMentionFormatter: Unstable_DirectiveFormatter = {
  serialize: (item) => `@${item.label}`,
  parse: (text) => {
    const segments: Unstable_DirectiveSegment[] = [];
    let lastIndex = 0;
    for (const match of text.matchAll(/@(图片|视频|音频|人像)\d+/g)) {
      if (match.index > lastIndex) segments.push({ kind: "text", text: text.slice(lastIndex, match.index) });
      const label = match[0].slice(1);
      segments.push({ kind: "mention", type: "asset", label, id: label });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) segments.push({ kind: "text", text: text.slice(lastIndex) });
    return segments;
  },
};

function useAiGenerateContext() {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error("AI Generate runtime is unavailable");
  return value;
}

function textFromMessage(message: AppendMessage) {
  return message.content
    .filter((part): part is Extract<(typeof message.content)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function referencesFromMessage(message: AppendMessage) {
  return message.content.flatMap((part) => {
    if (part.type !== "data" || part.name !== "ai-generate-reference") return [];
    return [part.data as unknown as AiGenerateReference];
  });
}

function referenceKind(mimeType: string) {
  return mimeType.startsWith("image/") ? "图片" : mimeType.startsWith("video/") ? "视频" : "音频";
}

function labelSelections(existing: AiGenerateReference[], assets: AttachmentSelection[]) {
  const next = [...existing];
  return assets.map((asset): AiGenerateReference => {
    const kind = referenceKind(asset.mimeType);
    const reference = {
      ...asset,
      label: `${kind}${next.filter((item) => referenceKind(item.mimeType) === kind).length + 1}`,
    };
    next.push(reference);
    return reference;
  });
}

function initialDraft(): AiGenerateDraft {
  return {
    kind: "image",
    prompt: "",
    modelId: "",
    ratio: "1:1",
    resolution: "1k",
    count: 1,
    duration: 5,
    seed: "",
    referenceMode: "",
    references: [],
    revisionMode: "new",
  };
}

function AiGenerateProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["api-tasks", "ai-generate"],
    queryFn: () => fetchJobs("ai-generate"),
    refetchInterval: 2_000,
  });
  const { data: capabilities } = useQuery({
    queryKey: ["creation-capabilities"],
    queryFn: fetchCreationCapabilities,
    staleTime: 60_000,
  });
  const models = capabilities?.models ?? [];
  const [draft, setDraft] = useState<AiGenerateDraft>(initialDraft);
  const messages = useMemo(() => jobsToThreadMessages(jobs), [jobs]);

  useEffect(() => {
    const available = models.filter((model) => model.kind === draft.kind && model.enabled);
    if (available.some((model) => model.id === draft.modelId)) return;
    const model = available.find((item) => item.isDefault) ?? available[0];
    if (!model) return;
    setDraft((current) => ({
      ...current,
      modelId: model.id,
      ratio: model.supportedRatios.includes(current.ratio)
        ? current.ratio
        : (model.supportedRatios[0] ?? current.ratio),
      resolution: model.supportedResolutions.includes(current.resolution)
        ? current.resolution
        : (model.supportedResolutions[0] ?? current.resolution),
      duration: model.supportedDurations.includes(current.duration)
        ? current.duration
        : (model.supportedDurations[0] ?? current.duration),
      referenceMode: model.referenceModes[0] ?? "",
    }));
  }, [draft.kind, draft.modelId, models]);

  const submit = async (
    prompt: string,
    references: AiGenerateReference[],
    parentJobId?: string,
    mode = draft.revisionMode,
  ) => {
    const resolved = resolveAssetMentions(prompt, references);
    if (resolved.unresolved.length) throw new Error(`${resolved.unresolved[0]} 未关联到当前素材`);
    const nextDraft = {
      ...draft,
      prompt,
      references: resolved.references,
      parentJobId,
      revisionMode: mode,
    };
    const model = models.find((item) => item.id === nextDraft.modelId && item.kind === nextDraft.kind);
    if (!model?.enabled) throw new Error(model?.disabledReason ?? "所选模型当前不可用");
    const referenceError = validateModelReferenceCount(
      model,
      countEffectiveReferences(resolved.references.length, parentJobId, mode),
    );
    if (referenceError) throw new Error(referenceError);
    const title = `${nextDraft.kind === "image" ? "图片" : "视频"}创作 · ${new Date().toLocaleTimeString()}`;
    await submitAiGenerateJob(buildAiGenerateRequest(nextDraft, title), randomUuid());
    setDraft((current) => ({ ...current, prompt: "", references: [], parentJobId: undefined, revisionMode: "new" }));
    await queryClient.invalidateQueries({ queryKey: ["api-tasks", "ai-generate"] });
  };

  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    convertMessage: (message) => message,
    isLoading,
    isRunning: jobs.some((job) => job.status === "queued" || job.status === "processing"),
    onNew: async (message) => {
      try {
        const messageReferences = referencesFromMessage(message);
        await submit(
          textFromMessage(message),
          messageReferences.length ? messageReferences : draft.references,
          draft.parentJobId,
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "任务提交失败");
        throw error;
      }
    },
    onEdit: async (message) => {
      const sourceJobId = message.sourceId?.replace(/:(user|assistant)$/, "");
      const source = jobs.find((job) => job.id === sourceJobId);
      await submit(
        textFromMessage(message),
        source ? parseJobReferences(source) : referencesFromMessage(message),
        sourceJobId,
        "edit",
      );
    },
    onReload: async (parentId) => {
      const sourceJobId = parentId?.replace(/:(user|assistant)$/, "");
      const source = jobs.find((job) => job.id === sourceJobId);
      if (!source) throw new Error("找不到需要重新生成的任务");
      await submit(source.values.prompt ?? source.title, parseJobReferences(source), source.id, "edit");
    },
  });

  return (
    <RuntimeContext.Provider value={{ jobs, draft, models, setDraft }}>
      <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
    </RuntimeContext.Provider>
  );
}

function ResultPart({ data }: { data: AiGenerateResultData }) {
  if (data.status === "queued" || data.status === "processing")
    return (
      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center gap-2 text-sm text-ink">
          <LoaderCircle className="size-4 animate-spin" />
          {data.stage} · {data.progress}%
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${data.progress}%` }} />
        </div>
      </div>
    );
  if (data.error)
    return (
      <div className="rounded-xl border border-error/30 bg-error/5 p-4 text-sm text-error">{data.error.message}</div>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {data.artifacts.map((artifact) => (
        <article className="overflow-hidden rounded-xl border border-line bg-surface" key={artifact.id}>
          {artifact.url && /^(image|video|audio)\//.test(artifact.mimeType) ? (
            <MediaPreview
              url={artifact.url}
              mimeType={artifact.mimeType}
              alt={artifact.name}
              authenticated
              className="h-64 w-full object-contain"
            />
          ) : (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap p-4 text-xs">{artifact.text}</pre>
          )}
          <footer className="flex items-center justify-between border-t border-line px-3 py-2">
            <span className="truncate text-xs text-muted">
              {artifact.name} · {artifact.executionMode}
            </span>
            {artifact.url && (
              <Button
                size="icon"
                variant="ghost"
                aria-label="下载"
                onClick={() => {
                  if (artifact.url) void downloadAuthenticated(artifact.url, artifact.name);
                }}
              >
                <Download />
              </Button>
            )}
          </footer>
        </article>
      ))}
    </div>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="mx-auto grid w-full max-w-4xl justify-items-end px-4 py-3">
      <div className="max-w-2xl rounded-2xl bg-primary px-4 py-3 text-sm text-white">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  const { jobs, setDraft } = useAiGenerateContext();
  const aui = useAui();
  const jobId = useAuiState((state) => state.message.metadata.custom?.jobId as string | undefined);
  const source = jobs.find((job) => job.id === jobId);
  const revise = (mode: "edit" | "variant") => {
    if (!source) return;
    setDraft((current) => ({
      ...current,
      kind: source.values.kind === "video" ? "video" : "image",
      modelId: source.values.modelId ?? current.modelId,
      ratio: source.values.ratio ?? current.ratio,
      resolution: source.values.resolution ?? current.resolution,
      duration: Number(source.values.duration || current.duration),
      count: Number(source.values.count || current.count),
      references: parseJobReferences(source),
      parentJobId: source.id,
      revisionMode: mode,
    }));
    aui
      .composer()
      .setText(
        mode === "variant" ? `${source.values.prompt ?? source.title}\n生成一个构图和风格不同的变体` : "继续修改：",
      );
  };
  return (
    <MessagePrimitive.Root className="mx-auto w-full max-w-4xl px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted">
        <Sparkles className="size-4" />
        AI 创作
      </div>
      <MessagePrimitive.Parts>
        {({ part }) => {
          if (part.type === "text") return <MessagePartPrimitive.Text className="text-sm text-ink" />;
          if (part.type === "data" && part.name === "ai-generate-result")
            return <ResultPart data={part.data as unknown as AiGenerateResultData} />;
          return null;
        }}
      </MessagePrimitive.Parts>
      <ActionBarPrimitive.Root className="mt-2 flex gap-1">
        <Button size="sm" variant="ghost" onClick={() => revise("edit")}>
          <RefreshCw />
          继续修改
        </Button>
        <Button size="sm" variant="ghost" onClick={() => revise("variant")}>
          <Sparkles />
          创建变体
        </Button>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

function ComposerAttachment() {
  return (
    <AttachmentPrimitive.Root className="flex max-w-44 items-center gap-2 rounded-lg border border-line bg-surface-muted px-2 py-1.5">
      <AttachmentPrimitive.unstable_Thumb className="flex size-8 items-center justify-center rounded-md bg-surface text-xs" />
      <span className="min-w-0 flex-1 truncate text-xs text-ink">
        <AttachmentPrimitive.Name />
      </span>
      <AttachmentPrimitive.Remove className="rounded-full p-1 text-muted hover:bg-surface" aria-label="移除素材">
        <X className="size-3" />
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
}

function AiGenerateComposer() {
  const { draft, models, setDraft } = useAiGenerateContext();
  const aui = useAui();
  const attachments = useAuiState((state) => state.composer.attachments);
  const attachedReferences = attachments.flatMap(
    (attachment) =>
      attachment.content?.flatMap((part) =>
        part.type === "data" && part.name === "ai-generate-reference"
          ? [part.data as unknown as AiGenerateReference]
          : [],
      ) ?? [],
  );
  const mention = unstable_useMentionAdapter({
    items: attachedReferences.map((reference) => ({
      id: reference.label,
      type: "asset",
      label: reference.label,
      description: reference.name,
    })),
    includeModelContextTools: false,
    formatter: assetMentionFormatter,
  });
  const filteredModels = models.filter((model) => model.kind === draft.kind);
  const model = filteredModels.find((item) => item.id === draft.modelId);
  const referenceError = model
    ? validateModelReferenceCount(
        model,
        countEffectiveReferences(attachedReferences.length, draft.parentJobId, draft.revisionMode),
      )
    : undefined;
  const addAssets = async (assets: AttachmentSelection[]) => {
    const current = aui
      .composer()
      .getState()
      .attachments.flatMap(
        (attachment) =>
          attachment.content?.flatMap((part) =>
            part.type === "data" && part.name === "ai-generate-reference"
              ? [part.data as unknown as AiGenerateReference]
              : [],
          ) ?? [],
      );
    for (const reference of labelSelections(current, assets))
      await aui.composer().addAttachment({
        id: reference.id,
        type: referenceKind(reference.mimeType),
        name: `@${reference.label} · ${reference.name}`,
        contentType: reference.mimeType,
        content: [{ type: "data", name: "ai-generate-reference", data: reference }],
      });
  };
  const switchKind = (kind: AiGenerateKind) =>
    setDraft((current) => ({
      ...current,
      kind,
      modelId: "",
      references: [],
      ratio: kind === "image" ? "1:1" : "9:16",
      resolution: kind === "image" ? "1k" : "720p",
      referenceMode: kind === "image" ? "" : "omni",
    }));
  return (
    <ComposerPrimitive.Root className="rounded-2xl border border-line bg-surface p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap gap-2">
        <ComposerPrimitive.Attachments>{() => <ComposerAttachment />}</ComposerPrimitive.Attachments>
      </div>
      <ComposerPrimitive.Unstable_TriggerPopoverRoot>
        <ComposerPrimitive.Input
          rows={2}
          placeholder="描述要生成或修改的内容，输入 @引用已添加的素材"
          className="max-h-40 min-h-16 w-full resize-none bg-transparent px-1 py-2 text-sm text-ink outline-none placeholder:text-muted"
        />
        <ComposerPrimitive.Unstable_TriggerPopover
          char="@"
          adapter={mention.adapter}
          className="absolute bottom-full left-3 z-30 mb-2 w-72 overflow-hidden rounded-lg border border-line bg-white p-1 shadow-sm"
          aria-label="引用素材"
        >
          <ComposerPrimitive.Unstable_TriggerPopover.Directive {...mention.directive} />
          <ComposerPrimitive.Unstable_TriggerPopoverItems>
            {(items) =>
              items.map((item, index) => (
                <ComposerPrimitive.Unstable_TriggerPopoverItem
                  item={item}
                  index={index}
                  key={item.id}
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-surface-muted data-highlighted:bg-surface-muted"
                >
                  <span>@{item.label}</span>
                  <small className="truncate text-xs text-muted">{item.description}</small>
                </ComposerPrimitive.Unstable_TriggerPopoverItem>
              ))
            }
          </ComposerPrimitive.Unstable_TriggerPopoverItems>
        </ComposerPrimitive.Unstable_TriggerPopover>
      </ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <div className="flex rounded-md border border-line p-0.5">
          <Button size="sm" variant={draft.kind === "image" ? "default" : "ghost"} onClick={() => switchKind("image")}>
            <Image />
            生图
          </Button>
          <Button size="sm" variant={draft.kind === "video" ? "default" : "ghost"} onClick={() => switchKind("video")}>
            <Video />
            生视频
          </Button>
        </div>
        <NativeSelect
          aria-label="生成模型"
          value={draft.modelId}
          onChange={(event) => setDraft((current) => ({ ...current, modelId: event.target.value }))}
        >
          {filteredModels.map((item) => (
            <option key={item.id} value={item.id} disabled={!item.enabled}>
              {item.displayName}
              {item.executionMode === "mock" ? " · Mock" : ""}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="画幅"
          value={draft.ratio}
          onChange={(event) => setDraft((current) => ({ ...current, ratio: event.target.value }))}
        >
          {(model?.supportedRatios ?? []).map((ratio) => (
            <option key={ratio} value={ratio}>
              {ratio === "adaptive" ? "自动画幅" : ratio}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="清晰度"
          value={draft.resolution}
          onChange={(event) => setDraft((current) => ({ ...current, resolution: event.target.value }))}
        >
          {(model?.supportedResolutions ?? []).map((resolution) => (
            <option key={resolution} value={resolution}>
              {resolution.toUpperCase()}
            </option>
          ))}
        </NativeSelect>
        {draft.kind === "video" && (
          <NativeSelect
            aria-label="视频时长"
            value={draft.duration}
            onChange={(event) => setDraft((current) => ({ ...current, duration: Number(event.target.value) }))}
          >
            {(model?.supportedDurations ?? []).map((duration) => (
              <option key={duration} value={duration}>
                {duration}s
              </option>
            ))}
          </NativeSelect>
        )}
        <AttachmentPicker
          multiple
          onSelect={(assets) => void addAssets(assets)}
          trigger={(open) => (
            <Button size="sm" variant="outline" onClick={open}>
              <Library />@ 引用素材
            </Button>
          )}
        />
        <ComposerPrimitive.Send asChild>
          <Button
            className="ml-auto rounded-full"
            aria-label="发送生成任务"
            disabled={!model?.enabled || Boolean(referenceError)}
            title={referenceError}
          >
            <Send />
            生成
          </Button>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
}

function AiGenerateThread() {
  return (
    <ThreadPrimitive.Root className="relative flex min-h-0 flex-1 flex-col bg-white">
      <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ThreadPrimitive.Empty>
          <div className="m-auto flex max-w-md flex-col items-center px-6 text-center">
            <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-muted">
              <Sparkles className="size-5 text-ink" />
            </div>
            <h1 className="text-2xl font-medium text-ink">AI 创作</h1>
          </div>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            AssistantMessage,
          }}
        />
        <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mx-auto w-full max-w-4xl bg-white/95 px-4 pb-4 pt-2 backdrop-blur">
          <ThreadPrimitive.ScrollToBottom asChild>
            <Button
              variant="outline"
              size="icon"
              className="absolute -top-10 left-1/2 -translate-x-1/2 rounded-full"
              aria-label="滚动到底部"
            >
              <ArrowDown />
            </Button>
          </ThreadPrimitive.ScrollToBottom>
          <AiGenerateComposer />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

export function AiGeneratePage() {
  return (
    <AiGenerateProvider>
      <div className="flex h-full min-h-0 bg-white">
        <AiGenerateThread />
      </div>
    </AiGenerateProvider>
  );
}
