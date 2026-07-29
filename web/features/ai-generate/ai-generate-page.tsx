import {
  ActionBarPrimitive,
  type AppendMessage,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  type ThreadMessageLike,
  type Unstable_DirectiveFormatter,
  type Unstable_DirectiveSegment,
  unstable_useMentionAdapter,
  useAui,
  useAuiState,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image, LoaderCircle, MessageSquare, Plus, RefreshCw, Sparkles, Video } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { downloadAuthenticated, fetchCreationCapabilities, fetchJobs, submitAiGenerateJob } from "@/api/api-client";
import type { GetCreationCapabilitiesResponse, Job } from "@/api/generated/types.gen";
import type { AttachmentSelection } from "@/components/domain/attachment-picker";
import { CreationAssistantComposer, CreationAssistantThread } from "@/components/domain/creation-assistant-composer";
import { MediaResultCard } from "@/components/domain/media-result-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { randomUuid } from "@/lib/random-id";
import { AiGenerateReferencePreview } from "./ai-generate-reference-preview";
import {
  type AiGenerateConversation,
  type AiGenerateDraft,
  type AiGenerateKind,
  type AiGenerateReference,
  type AiGenerateResultData,
  buildAiGenerateRequest,
  buildProfessionalPrompt,
  countEffectiveReferences,
  groupAiGenerateConversations,
  jobsToThreadMessages,
  parseJobReferences,
  parseProfessionalPrompt,
  referenceAccept,
  referencesFromAppendMessage,
  resolveAssetMentions,
  resolveReferenceMode,
  seedanceReferenceConstraints,
  supportsMediaReference,
  validateModelReferenceCount,
} from "./ai-generate-runtime";

type RuntimeContextValue = {
  jobs: Job[];
  conversations: AiGenerateConversation[];
  activeConversation?: Pick<AiGenerateConversation, "id" | "name">;
  selectConversation: (conversation: Pick<AiGenerateConversation, "id" | "name">) => void;
  createConversation: (name: string) => void;
  draft: AiGenerateDraft;
  models: GetCreationCapabilitiesResponse["models"];
  setDraft: React.Dispatch<React.SetStateAction<AiGenerateDraft>>;
  submitVariant: (source: Job) => Promise<void>;
  restoreRequest?: Job;
  restoreRevision: (source: Job) => void;
  clearRestoreRequest: () => void;
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
  const [draftsByConversation, setDraftsByConversation] = useState<Record<string, AiGenerateDraft>>({});
  const [createdConversations, setCreatedConversations] = useState<Pick<AiGenerateConversation, "id" | "name">[]>([]);
  const [activeConversation, setActiveConversation] = useState<Pick<AiGenerateConversation, "id" | "name">>();
  const [restoreRequest, setRestoreRequest] = useState<Job>();
  const conversations = useMemo(() => {
    const persisted = groupAiGenerateConversations(jobs);
    const persistedIds = new Set(persisted.map((conversation) => conversation.id));
    const pending = createdConversations
      .filter((conversation) => !persistedIds.has(conversation.id))
      .map((conversation) => ({ ...conversation, jobs: [] }));
    return [...pending, ...persisted];
  }, [createdConversations, jobs]);
  const activeConversationId = activeConversation?.id;
  const activeJobs = useMemo(
    () =>
      activeConversationId === "unclassified"
        ? jobs.filter((job) => !job.values.conversationId)
        : jobs.filter((job) => job.values.conversationId === activeConversationId),
    [activeConversationId, jobs],
  );
  const messages = useMemo(() => jobsToThreadMessages(activeJobs), [activeJobs]);

  useEffect(() => {
    if (activeConversation || !conversations.length) return;
    const latest = conversations[0];
    if (latest) setActiveConversation({ id: latest.id, name: latest.name });
  }, [activeConversation, conversations]);

  const selectConversation = (conversation: Pick<AiGenerateConversation, "id" | "name">) => {
    if (activeConversation) setDraftsByConversation((current) => ({ ...current, [activeConversation.id]: draft }));
    setActiveConversation(conversation);
    setDraft(draftsByConversation[conversation.id] ?? initialDraft());
    setRestoreRequest(undefined);
  };

  const createConversation = (name: string) => {
    const conversation = { id: randomUuid(), name: name.trim() };
    setCreatedConversations((current) => [conversation, ...current]);
    selectConversation(conversation);
  };

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

  const submitDraft = async (nextDraft: AiGenerateDraft, clearDraft: boolean) => {
    if (!activeConversation) throw new Error("请先新建产品对话");
    const resolved = resolveAssetMentions(nextDraft.prompt, nextDraft.references);
    if (resolved.unresolved.length) throw new Error(`${resolved.unresolved[0]} 未关联到当前素材`);
    const resolvedDraft = { ...nextDraft, references: resolved.references };
    const model = models.find((item) => item.id === resolvedDraft.modelId && item.kind === resolvedDraft.kind);
    if (!model?.enabled) throw new Error(model?.disabledReason ?? "所选模型当前不可用");
    const requestDraft = {
      ...resolvedDraft,
      conversationId: activeConversation?.id,
      conversationName: activeConversation?.name,
      referenceMode: resolveReferenceMode(resolvedDraft.kind, resolvedDraft.referenceMode, model.referenceModes),
    };
    if (requestDraft.kind === "video" && !requestDraft.referenceMode) throw new Error("所选视频模型未提供参考模式");
    const referenceError = validateModelReferenceCount(
      model,
      countEffectiveReferences(resolved.references.length, requestDraft.parentJobId, requestDraft.revisionMode),
    );
    if (referenceError) throw new Error(referenceError);
    const title = `${requestDraft.kind === "image" ? "图片" : "视频"}创作 · ${new Date().toLocaleTimeString()}`;
    await submitAiGenerateJob(buildAiGenerateRequest(requestDraft, title), randomUuid());
    if (clearDraft)
      setDraft((current) => ({ ...current, prompt: "", references: [], parentJobId: undefined, revisionMode: "new" }));
    await queryClient.invalidateQueries({ queryKey: ["api-tasks", "ai-generate"] });
  };
  const submit = async (
    prompt: string,
    references: AiGenerateReference[],
    parentJobId?: string,
    mode = draft.revisionMode,
  ) => {
    await submitDraft(
      {
        ...draft,
        prompt,
        references,
        parentJobId,
        revisionMode: mode,
      },
      true,
    );
  };
  const submitVariant = async (source: Job) =>
    submitDraft(
      {
        ...draft,
        kind: source.values.kind === "video" ? "video" : "image",
        prompt: source.values.prompt ?? source.title,
        modelId: source.values.modelId ?? draft.modelId,
        ratio: source.values.ratio ?? draft.ratio,
        resolution: source.values.resolution ?? draft.resolution,
        duration: Number(source.values.duration || draft.duration),
        count: Number(source.values.count || draft.count),
        references: parseJobReferences(source),
        conversationId: source.values.conversationId,
        conversationName: source.values.conversationName,
        parentJobId: source.id,
        revisionMode: "variant",
      },
      false,
    );
  const restoreRevision = (source: Job) => {
    setDraft((current) => ({
      ...current,
      kind: source.values.kind === "video" ? "video" : "image",
      modelId: source.values.modelId ?? current.modelId,
      ratio: source.values.ratio ?? current.ratio,
      resolution: source.values.resolution ?? current.resolution,
      duration: Number(source.values.duration || current.duration),
      count: Number(source.values.count || current.count),
      references: parseJobReferences(source),
      conversationId: source.values.conversationId,
      conversationName: source.values.conversationName,
      // “继续修改”只复用原始文本与参考素材；任务尚未成功时不能作为服务端谱系父任务。
      parentJobId: source.status === "succeeded" ? source.id : undefined,
      revisionMode: source.status === "succeeded" ? "edit" : "new",
    }));
    setRestoreRequest(source);
  };

  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    convertMessage: (message) => message,
    isLoading,
    isRunning: activeJobs.some((job) => job.status === "queued" || job.status === "processing"),
    onNew: async (message) => {
      try {
        const messageReferences = referencesFromAppendMessage(message);
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
        source ? parseJobReferences(source) : referencesFromAppendMessage(message),
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
    <RuntimeContext.Provider
      value={{
        jobs,
        conversations,
        activeConversation,
        selectConversation,
        createConversation,
        draft,
        models,
        setDraft,
        submitVariant,
        restoreRequest,
        restoreRevision,
        clearRestoreRequest: () => setRestoreRequest(undefined),
      }}
    >
      <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
    </RuntimeContext.Provider>
  );
}

function ResultPart({ data }: { data: AiGenerateResultData }) {
  if (data.status === "queued" || data.status === "processing")
    return (
      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center gap-2 type-body text-ink">
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
      <div className="rounded-xl border border-error/30 bg-error/5 p-4 type-body text-error">{data.error.message}</div>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {data.artifacts.map((artifact) =>
        artifact.url && /^(image|video|audio)\//.test(artifact.mimeType) ? (
          <MediaResultCard
            key={artifact.id}
            url={artifact.url}
            mimeType={artifact.mimeType}
            name={artifact.name}
            authenticated
            onDownload={() => {
              if (artifact.url) void downloadAuthenticated(artifact.url, artifact.name);
            }}
          />
        ) : (
          <article className="overflow-hidden rounded-xl border border-line bg-surface" key={artifact.id}>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap p-4 type-helper">{artifact.text}</pre>
            <footer className="flex min-h-12 items-center border-t border-line px-3 py-2">
              <span className="truncate type-helper text-muted">
                {artifact.name} · {artifact.executionMode}
              </span>
            </footer>
          </article>
        ),
      )}
    </div>
  );
}

function UserMessage() {
  const references = useAuiState(
    (state) => (state.message.metadata?.custom as { references?: AiGenerateReference[] } | undefined)?.references ?? [],
  );
  return (
    <MessagePrimitive.Root className="mx-auto grid w-full max-w-4xl justify-items-end px-4 py-3">
      <div className="max-w-2xl rounded-2xl bg-primary px-4 py-3 type-body text-on-primary">
        <MessagePrimitive.Parts />
        <div className="mt-3 border-t border-on-primary/20 pt-3">
          <AiGenerateReferencePreview references={references} removable={false} />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  const { jobs, restoreRevision, submitVariant } = useAiGenerateContext();
  const jobId = useAuiState((state) => {
    const metadataJobId = state.message.metadata.custom?.jobId;
    if (typeof metadataJobId === "string") return metadataJobId;
    const result = state.message.content.find((part) => part.type === "data" && part.name === "ai-generate-result");
    return result?.type === "data" ? (result.data as AiGenerateResultData).jobId : undefined;
  });
  const source = jobs.find((job) => job.id === jobId);
  const restoreSource = () => {
    if (!source) {
      toast.error("找不到对应的创作任务");
      return;
    }
    restoreRevision(source);
  };
  const createVariant = async () => {
    if (!source) {
      toast.error("找不到对应的创作任务");
      return;
    }
    try {
      await submitVariant(source);
      toast.success("已提交新的创作变体");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建变体失败");
    }
  };
  return (
    <MessagePrimitive.Root className="mx-auto w-full max-w-4xl px-4 py-3">
      <div className="mb-2 flex items-center gap-2 type-helper text-muted">
        <Sparkles className="size-4" />
        AI 创作
      </div>
      <MessagePrimitive.Parts>
        {({ part }) => {
          if (part.type === "text") return <MessagePartPrimitive.Text className="type-body text-ink" />;
          if (part.type === "data" && part.name === "ai-generate-result")
            return <ResultPart data={part.data as unknown as AiGenerateResultData} />;
          return null;
        }}
      </MessagePrimitive.Parts>
      <ActionBarPrimitive.Root className="mt-2 flex gap-1">
        <Button size="sm" variant="ghost" onClick={restoreSource}>
          <RefreshCw />
          继续修改
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void createVariant()}>
          <Sparkles />
          创建变体
        </Button>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

function AiGenerateComposer() {
  const { draft, models, setDraft, restoreRequest, clearRestoreRequest } = useAiGenerateContext();
  const aui = useAui();
  const [composerMode, setComposerMode] = useState<"concise" | "professional">("concise");
  const [professionalFields, setProfessionalFields] = useState({ script: "", environment: "", emphasis: "" });
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
  const professionalPrompt = buildProfessionalPrompt(professionalFields);
  const accept = referenceAccept(model);
  const canAttachReferences = Boolean(accept) && Boolean(model?.enabled);
  useEffect(() => {
    if (!model) return;
    const composer = aui.composer();
    const attachments = composer.getState().attachments;
    const compatibleAttachments = attachments.filter((attachment) => {
      const unsupported = attachment.content?.some(
        (part) =>
          part.type === "data" &&
          part.name === "ai-generate-reference" &&
          !supportsMediaReference(model, (part.data as AiGenerateReference).mimeType),
      );
      return !unsupported;
    });
    const removedCount = attachments.length - compatibleAttachments.length;
    if (!removedCount) return;
    void (async () => {
      await composer.clearAttachments();
      for (const attachment of compatibleAttachments)
        await composer.addAttachment({
          id: attachment.id,
          type: attachment.type,
          name: attachment.name,
          contentType: attachment.contentType,
          content: attachment.content ?? [],
        });
      toast.warning(`已移除 ${removedCount} 个新模型不支持的参考素材`);
    })();
  }, [aui, model]);
  useEffect(() => {
    if (!restoreRequest) return;
    const composer = aui.composer();
    const references = parseJobReferences(restoreRequest);
    const restoredPrompt = restoreRequest.values.prompt ?? restoreRequest.title;
    const professionalFields = parseProfessionalPrompt(restoredPrompt);
    void (async () => {
      try {
        setComposerMode(professionalFields ? "professional" : "concise");
        if (professionalFields) setProfessionalFields(professionalFields);
        await composer.clearAttachments();
        for (const reference of references)
          await composer.addAttachment({
            id: reference.id,
            type: referenceKind(reference.mimeType),
            name: `@${reference.label} · ${reference.name}`,
            contentType: reference.mimeType,
            content: [{ type: "data", name: "ai-generate-reference", data: reference }],
          });
        composer.setText(restoredPrompt);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "回填创作内容失败");
      } finally {
        clearRestoreRequest();
      }
    })();
  }, [aui, clearRestoreRequest, restoreRequest]);
  useEffect(() => {
    if (composerMode === "professional") aui.composer().setText(professionalPrompt);
  }, [aui, composerMode, professionalPrompt]);
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
  const removeReference = async (referenceId: string) => {
    const composer = aui.composer();
    const remaining = composer
      .getState()
      .attachments.filter(
        (attachment) =>
          !attachment.content?.some(
            (part) =>
              part.type === "data" &&
              part.name === "ai-generate-reference" &&
              (part.data as AiGenerateReference).id === referenceId,
          ),
      );
    await composer.clearAttachments();
    for (const attachment of remaining)
      await composer.addAttachment({
        id: attachment.id,
        type: attachment.type,
        name: attachment.name,
        contentType: attachment.contentType,
        content: attachment.content ?? [],
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
    <CreationAssistantComposer
      references={attachedReferences}
      placeholder="描述要生成或修改的内容，输入 @引用已添加的素材"
      header={
        <div className="mb-3 flex items-center gap-1">
          <Button
            size="sm"
            variant={composerMode === "concise" ? "default" : "ghost"}
            onClick={() => setComposerMode("concise")}
          >
            简洁版
          </Button>
          <Button
            size="sm"
            variant={composerMode === "professional" ? "default" : "ghost"}
            onClick={() => setComposerMode("professional")}
          >
            专业版
          </Button>
        </div>
      }
      input={
        composerMode === "professional" ? (
          <div className="mb-3 overflow-hidden rounded-xl border border-line">
            {(
              [
                ["script", "脚本", "描述视频主题、核心内容、故事结构或脚本要点"],
                ["environment", "环境与运镜", "填写场景环境、画面风格、镜头语言与运镜方式"],
                ["emphasis", "强调点", "填写需要重点突出的产品功能、卖点或记忆点"],
              ] as const
            ).map(([key, label, placeholder]) => (
              <label className="grid grid-cols-[132px_minmax(0,1fr)] border-b border-line last:border-b-0" key={key}>
                <span className="flex items-center border-r border-line px-3 type-body-strong text-ink">{label}</span>
                <textarea
                  value={professionalFields[key]}
                  placeholder={placeholder}
                  rows={2}
                  className="min-h-18 resize-y bg-transparent px-3 py-2 type-body text-ink outline-none placeholder:text-muted"
                  onChange={(event) => setProfessionalFields((current) => ({ ...current, [key]: event.target.value }))}
                />
              </label>
            ))}
          </div>
        ) : (
          <ComposerPrimitive.Unstable_TriggerPopoverRoot>
            <ComposerPrimitive.Input
              rows={2}
              placeholder="描述要生成或修改的内容，输入 @引用已添加的素材"
              className="max-h-40 min-h-16 w-full resize-none bg-transparent px-1 py-2 type-body text-ink outline-none placeholder:text-muted"
            />
            <ComposerPrimitive.Unstable_TriggerPopover
              char="@"
              adapter={mention.adapter}
              className="absolute bottom-full left-3 z-30 mb-2 w-72 overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-sm"
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
                      className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left type-body text-ink hover:bg-surface-muted data-highlighted:bg-surface-muted"
                    >
                      <span>@{item.label}</span>
                      <small className="truncate type-helper text-muted">{item.description}</small>
                    </ComposerPrimitive.Unstable_TriggerPopoverItem>
                  ))
                }
              </ComposerPrimitive.Unstable_TriggerPopoverItems>
            </ComposerPrimitive.Unstable_TriggerPopover>
          </ComposerPrimitive.Unstable_TriggerPopoverRoot>
        )
      }
      controls={
        <>
          <div className="flex rounded-md border border-line p-0.5">
            <Button
              size="sm"
              variant={draft.kind === "image" ? "default" : "ghost"}
              onClick={() => switchKind("image")}
            >
              <Image />
              生图
            </Button>
            <Button
              size="sm"
              variant={draft.kind === "video" ? "default" : "ghost"}
              onClick={() => switchKind("video")}
            >
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
        </>
      }
      attachment={
        accept
          ? {
              accept,
              constraints: seedanceReferenceConstraints(model),
              multiple: true,
              showMediaTypeFilters: true,
              disabled: !canAttachReferences,
              disabledReason: model?.disabledReason,
              onSelect: (assets) => void addAssets(assets),
            }
          : undefined
      }
      sendLabel="生成"
      sendAriaLabel="发送生成任务"
      sendDisabled={!model?.enabled || Boolean(referenceError)}
      sendTitle={referenceError}
      onRemoveReference={(id) => void removeReference(id)}
    />
  );
}

function AiGenerateConversationRail() {
  const { activeConversation, conversations, createConversation, selectConversation } = useAiGenerateContext();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const validName = name.trim().length > 0 && name.trim().length <= 80;

  const submit = () => {
    if (!validName) return;
    createConversation(name);
    setName("");
    setOpen(false);
  };

  return (
    <>
      <aside
        aria-label="产品对话"
        className="flex h-full min-h-0 w-56 shrink-0 flex-col overflow-hidden border-r border-line bg-surface-muted/30 p-3"
      >
        <Button className="w-full" size="sm" onClick={() => setOpen(true)}>
          <Plus /> 新建对话
        </Button>
        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {conversations.map((conversation) => {
            const selected = activeConversation?.id === conversation.id;
            return (
              <Button
                key={conversation.id}
                variant={selected ? "default" : "ghost"}
                className="h-auto w-full justify-start gap-2 px-3 py-2 text-left"
                onClick={() => selectConversation(conversation)}
              >
                <MessageSquare className="size-4 shrink-0" />
                <span className="truncate">{conversation.name}</span>
                <span className="ml-auto type-helper text-muted">{conversation.jobs.length}</span>
              </Button>
            );
          })}
        </div>
      </aside>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建对话</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            aria-label="产品名称"
            maxLength={80}
            placeholder="产品名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button disabled={!validName} onClick={submit}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AiGenerateThread() {
  return (
    <CreationAssistantThread
      title="AI 创作"
      composer={<AiGenerateComposer />}
      messageComponents={{ UserMessage, AssistantMessage }}
    />
  );
}

export function AiGeneratePage() {
  return (
    <AiGenerateProvider>
      <div className="flex h-[calc(100dvh-56px)] min-h-0 overflow-hidden bg-surface">
        <AiGenerateConversationRail />
        <AiGenerateThread />
      </div>
    </AiGenerateProvider>
  );
}
