import {
  ActionBarPrimitive,
  type AppendMessage,
  AssistantRuntimeProvider,
  MessagePartPrimitive,
  MessagePrimitive,
  type ThreadMessageLike,
  useAui,
  useAuiState,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { fetchJobs, fetchMediaUnderstandCapabilities, submitMediaUnderstandJob } from "@/api/api-client";
import type { Job } from "@/api/generated/types.gen";
import type { AttachmentSelection } from "@/components/domain/attachment-picker";
import {
  CreationAssistantComposer,
  CreationAssistantReferencePreview,
  CreationAssistantThread,
} from "@/components/domain/creation-assistant-composer";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { randomUuid } from "@/lib/random-id";
import {
  buildMediaUnderstandSubmission,
  classifyMediaUnderstandSelection,
  type MediaUnderstandReference,
  type MediaUnderstandResultData,
  type MediaUnderstandSelection,
  mediaUnderstandJobsToThreadMessages,
  mediaUnderstandReferenceLabels,
  mediaUnderstandReferencesFromAppendMessage,
  parseMediaUnderstandJobReferences,
} from "./media-understand-runtime";

type ModelId = Awaited<ReturnType<typeof fetchMediaUnderstandCapabilities>>["models"][number]["id"];
type ReasoningEffort = Awaited<ReturnType<typeof fetchMediaUnderstandCapabilities>>["reasoningEfforts"][number];

type MediaUnderstandContextValue = {
  jobs: Job[];
  models: Awaited<ReturnType<typeof fetchMediaUnderstandCapabilities>>["models"];
  modelId?: ModelId;
  reasoning: ReasoningEffort;
  setModelId: (modelId: ModelId) => void;
  setReasoning: (reasoning: ReasoningEffort) => void;
  restoreRequest?: Job;
  restore: (job: Job) => void;
  clearRestoreRequest: () => void;
};

const MediaUnderstandContext = createContext<MediaUnderstandContextValue | null>(null);

function useMediaUnderstandContext() {
  const value = useContext(MediaUnderstandContext);
  if (!value) throw new Error("Media understanding runtime is unavailable");
  return value;
}

function textFromMessage(message: AppendMessage) {
  return message.content
    .filter((part): part is Extract<(typeof message.content)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function primaryKind(mimeType: string) {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "image";
}

function MediaUnderstandProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["api-tasks", "media-understand"],
    queryFn: () => fetchJobs("media-understand"),
    refetchInterval: 2_000,
  });
  const { data: capabilities } = useQuery({
    queryKey: ["media-understand-capabilities"],
    queryFn: fetchMediaUnderstandCapabilities,
    staleTime: 60_000,
  });
  const models = capabilities?.models ?? [];
  const [modelId, setModelId] = useState<ModelId>();
  const [reasoning, setReasoning] = useState<ReasoningEffort>("medium");
  const [restoreRequest, setRestoreRequest] = useState<Job>();
  const messages = useMemo(() => mediaUnderstandJobsToThreadMessages(jobs), [jobs]);

  useEffect(() => {
    if (modelId && models.some((model) => model.id === modelId && model.enabled)) return;
    setModelId((models.find((model) => model.isDefault && model.enabled) ?? models.find((model) => model.enabled))?.id);
  }, [modelId, models]);

  const submit = async (prompt: string, references: MediaUnderstandReference[]) => {
    const selection = classifyMediaUnderstandSelection(references, []);
    if (!selection.primary) throw new Error("请先添加一个需要理解的主素材");
    if (!modelId) throw new Error("当前没有可用的素材理解模型");
    const model = models.find((item) => item.id === modelId);
    if (!model?.enabled || !model.acceptedPrimaryKinds.includes(primaryKind(selection.primary.mimeType)))
      throw new Error(model?.disabledReason ?? "所选模型不支持当前主素材");
    await submitMediaUnderstandJob(
      buildMediaUnderstandSubmission({
        modelId,
        reasoningEffort: reasoning,
        prompt,
        primary: selection.primary,
        references: selection.references,
      }),
      randomUuid(),
    );
    await queryClient.invalidateQueries({ queryKey: ["api-tasks", "media-understand"] });
  };

  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    convertMessage: (message) => message,
    isLoading,
    isRunning: jobs.some((job) => job.status === "queued" || job.status === "processing"),
    onNew: async (message) => {
      try {
        await submit(textFromMessage(message), mediaUnderstandReferencesFromAppendMessage(message));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "素材理解任务提交失败");
        throw error;
      }
    },
    onReload: async (parentId) => {
      const sourceJobId = parentId?.replace(/:(user|assistant)$/, "");
      const source = jobs.find((job) => job.id === sourceJobId);
      if (!source) throw new Error("找不到需要重新分析的任务");
      await submit(source.values.prompt ?? source.title, parseMediaUnderstandJobReferences(source));
    },
  });

  return (
    <MediaUnderstandContext.Provider
      value={{
        jobs,
        models,
        modelId,
        reasoning,
        setModelId,
        setReasoning,
        restoreRequest,
        restore: setRestoreRequest,
        clearRestoreRequest: () => setRestoreRequest(undefined),
      }}
    >
      <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
    </MediaUnderstandContext.Provider>
  );
}

function MediaUnderstandResult({ data }: { data: MediaUnderstandResultData }) {
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
    <div className="grid gap-3">
      {data.artifacts.map((artifact) => (
        <article className="overflow-hidden rounded-xl border border-line bg-surface" key={artifact.id}>
          <pre className="max-h-[50dvh] overflow-auto whitespace-pre-wrap p-4 type-helper">{artifact.text}</pre>
          <footer className="flex min-h-12 items-center border-t border-line px-3 py-2">
            <span className="truncate type-helper text-muted">
              {artifact.name} · {artifact.executionMode}
            </span>
          </footer>
        </article>
      ))}
    </div>
  );
}

function MediaUnderstandUserMessage() {
  const references = useAuiState(
    (state) =>
      (state.message.metadata?.custom as { references?: MediaUnderstandReference[] } | undefined)?.references ?? [],
  );
  return (
    <MessagePrimitive.Root className="mx-auto grid w-full max-w-4xl justify-items-end px-4 py-3">
      <div className="max-w-2xl rounded-2xl bg-primary px-4 py-3 type-body text-on-primary">
        <MessagePrimitive.Parts />
        <div className="mt-3 border-t border-on-primary/20 pt-3">
          <CreationAssistantReferencePreview references={references} />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function MediaUnderstandAssistantMessage() {
  const { jobs, restore } = useMediaUnderstandContext();
  const jobId = useAuiState((state) => {
    const metadataJobId = state.message.metadata.custom?.jobId;
    if (typeof metadataJobId === "string") return metadataJobId;
    const result = state.message.content.find(
      (part) => part.type === "data" && part.name === "media-understand-result",
    );
    return result?.type === "data" ? (result.data as MediaUnderstandResultData).jobId : undefined;
  });
  const source = jobs.find((job) => job.id === jobId);
  return (
    <MessagePrimitive.Root className="mx-auto w-full max-w-4xl px-4 py-3">
      <div className="mb-2 flex items-center gap-2 type-helper text-muted">
        <Sparkles className="size-4" />
        素材理解
      </div>
      <MessagePrimitive.Parts>
        {({ part }) => {
          if (part.type === "text") return <MessagePartPrimitive.Text className="type-body text-ink" />;
          if (part.type === "data" && part.name === "media-understand-result")
            return <MediaUnderstandResult data={part.data as unknown as MediaUnderstandResultData} />;
          return null;
        }}
      </MessagePrimitive.Parts>
      <ActionBarPrimitive.Root className="mt-2 flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (source) restore(source);
            else toast.error("找不到对应的素材理解任务");
          }}
        >
          <RefreshCw />
          继续修改
        </Button>
        <ActionBarPrimitive.Reload asChild>
          <Button size="sm" variant="ghost">
            <Sparkles />
            重新分析
          </Button>
        </ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

function addReferenceAttachment(
  composer: ReturnType<ReturnType<typeof useAui>["composer"]>,
  reference: MediaUnderstandReference,
) {
  return composer.addAttachment({
    id: reference.id,
    type: reference.label,
    name: `@${reference.label} · ${reference.name}`,
    contentType: reference.mimeType,
    content: [{ type: "data", name: "media-understand-reference", data: reference }],
  });
}

function MediaUnderstandComposer() {
  const { models, modelId, reasoning, setModelId, setReasoning, restoreRequest, clearRestoreRequest } =
    useMediaUnderstandContext();
  const aui = useAui();
  const attachments = useAuiState((state) => state.composer.attachments);
  const references = attachments.flatMap(
    (attachment) =>
      attachment.content?.flatMap((part) =>
        part.type === "data" && part.name === "media-understand-reference"
          ? [part.data as unknown as MediaUnderstandReference]
          : [],
      ) ?? [],
  );
  const selection = classifyMediaUnderstandSelection(references, []);
  const kind = selection.primary ? primaryKind(selection.primary.mimeType) : undefined;
  const availableModels = models.map((model) => ({
    ...model,
    enabled: model.enabled && (!kind || model.acceptedPrimaryKinds.includes(kind)),
  }));
  const model = availableModels.find((item) => item.id === modelId);

  useEffect(() => {
    if (model?.enabled) return;
    const next =
      availableModels.find((item) => item.isDefault && item.enabled) ?? availableModels.find((item) => item.enabled);
    if (next) setModelId(next.id);
  }, [availableModels, model?.enabled, setModelId]);

  useEffect(() => {
    if (!restoreRequest) return;
    const composer = aui.composer();
    const restoredReferences = parseMediaUnderstandJobReferences(restoreRequest);
    void (async () => {
      try {
        await composer.clearAttachments();
        for (const reference of restoredReferences) await addReferenceAttachment(composer, reference);
        composer.setText(restoreRequest.values.prompt ?? restoreRequest.title);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "回填素材理解内容失败");
      } finally {
        clearRestoreRequest();
      }
    })();
  }, [aui, clearRestoreRequest, restoreRequest]);

  const replaceReferences = async (next: MediaUnderstandSelection[]) => {
    const normalized = classifyMediaUnderstandSelection(next, []);
    const labels = mediaUnderstandReferenceLabels(normalized.primary, normalized.references);
    const nextReferences = [normalized.primary, ...normalized.references]
      .filter((item): item is MediaUnderstandSelection => Boolean(item))
      .map((item) => ({ ...item, label: labels.get(item.id) ?? item.name }));
    const composer = aui.composer();
    await composer.clearAttachments();
    for (const reference of nextReferences) await addReferenceAttachment(composer, reference);
    if (normalized.rejected.length)
      toast.warning(`未添加：${normalized.rejected.join("、")}。只允许 1 个主素材和最多 5 张商品参考图`);
  };

  const addAssets = (assets: AttachmentSelection[]) =>
    replaceReferences([
      ...references,
      ...assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        mimeType: asset.mimeType,
        size: asset.size,
        durationSec: asset.durationSec,
        thumbnailUrl: asset.thumbnailUrl,
        url: asset.url,
        originalUrl: asset.originalUrl,
      })),
    ]);

  const removeReference = (referenceId: string) =>
    replaceReferences(references.filter((reference) => reference.id !== referenceId));

  const sendError = !selection.primary
    ? "请先添加一个需要理解的主素材"
    : !model?.enabled
      ? "当前没有支持该素材类型的模型"
      : undefined;

  return (
    <CreationAssistantComposer
      references={references}
      placeholder="例如：将原视频里的皮带改成透明玻璃大茶缸，生成一份卖大茶缸的 JSON 镜头脚本"
      controls={
        <>
          <NativeSelect
            aria-label="素材理解模型"
            value={modelId ?? ""}
            onChange={(event) => setModelId(event.target.value as ModelId)}
          >
            {availableModels.map((item) => (
              <option key={item.id} value={item.id} disabled={!item.enabled}>
                {item.displayName}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label="思考深度"
            value={reasoning}
            onChange={(event) => setReasoning(event.target.value as ReasoningEffort)}
          >
            <option value="off">关闭</option>
            <option value="medium">标准</option>
            <option value="high">深入</option>
          </NativeSelect>
        </>
      }
      attachment={{
        accept: "image/*,video/*,audio/*",
        multiple: true,
        onSelect: (assets) => void addAssets(assets),
      }}
      sendLabel="分析"
      sendAriaLabel="发送素材理解任务"
      sendDisabled={Boolean(sendError)}
      sendTitle={sendError}
      onRemoveReference={(id) => void removeReference(id)}
    />
  );
}

function MediaUnderstandThread() {
  return (
    <CreationAssistantThread
      title="素材理解"
      composer={<MediaUnderstandComposer />}
      messageComponents={{
        UserMessage: MediaUnderstandUserMessage,
        AssistantMessage: MediaUnderstandAssistantMessage,
      }}
    />
  );
}

export function MediaUnderstandPage() {
  return (
    <MediaUnderstandProvider>
      <div className="flex h-[calc(100dvh-56px)] min-h-0 overflow-hidden bg-surface">
        <MediaUnderstandThread />
      </div>
    </MediaUnderstandProvider>
  );
}
