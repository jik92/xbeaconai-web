import { useQuery } from "@tanstack/react-query";
import { Box, Check, ChevronDown, LoaderCircle, ScanSearch, X } from "lucide-react";
import { useRef, useState } from "react";
import { fetchJobs, submitJob, uploadMediaFile } from "@/api/api-client";
import type { Job } from "@/api/generated/types.gen";
import { type PromptReference, PromptWorkbench } from "@/components/domain/prompt-workbench";
import type { ApiJobResult } from "@/entities/types";
import { randomUuid } from "@/lib/random-id";
import "./media-understand-page.css";

type Panel = "model" | "reasoning" | undefined;
type UploadedReference = PromptReference & { assetId: string; mimeType: string };

const models = [
  { id: "seed-2-pro", name: "字节Seed 2.0 Pro", description: "适合视频、图片和音频的综合素材理解" },
  { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", description: "适合快速提取时间轴、对白和商品信息" },
];
const reasoningOptions = [
  { id: "off", label: "关闭" },
  { id: "medium", label: "标准" },
  { id: "high", label: "深入" },
] as const;

function referenceKind(mimeType: string): PromptReference["kind"] {
  return mimeType.startsWith("video/") ? "video" : mimeType.startsWith("audio/") ? "audio" : "image";
}

export function MediaUnderstandPage() {
  const [references, setReferences] = useState<UploadedReference[]>([]);
  const [prompt, setPrompt] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [panel, setPanel] = useState<Panel>();
  const [model, setModel] = useState(models[0].id);
  const [reasoning, setReasoning] = useState<(typeof reasoningOptions)[number]["id"]>("off");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedTask, setSelectedTask] = useState<Job | null>(null);
  const requestKey = useRef(randomUuid());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { data: tasks = [], refetch } = useQuery({
    queryKey: ["api-tasks", "media-understand"],
    queryFn: () => fetchJobs("media-understand"),
    refetchInterval: 4_000,
  });

  const chooseFiles = async (files: File[]) => {
    if (!files.length) return;
    if (references.length + files.length > 20) {
      setNotice("单次最多分析 20 个素材");
      return;
    }
    setUploading(true);
    setNotice("");
    try {
      const assets = await Promise.all(files.map(uploadMediaFile));
      setReferences((current) => [
        ...current,
        ...assets.map((asset) => ({
          id: asset.id,
          assetId: asset.id,
          name: asset.name,
          mimeType: asset.mimeType,
          kind: referenceKind(asset.mimeType),
        })),
      ]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "素材上传失败");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const submit = async () => {
    if (!references.length) {
      setNotice("请先添加需要理解的图片、视频或音频素材");
      fileInputRef.current?.click();
      return;
    }
    setSubmitting(true);
    setNotice("");
    try {
      await submitJob(
        "media-understand",
        `素材理解 · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        {
          source: `assets:${JSON.stringify(references.map((item) => ({ id: item.assetId, name: item.name, mimeType: item.mimeType })))}`,
          dimensions: "全量分析",
          focus: prompt.trim(),
          language: "简体中文",
          modelId: model,
          reasoningEffort: reasoning,
        },
        undefined,
        requestKey.current,
      );
      requestKey.current = randomUuid();
      setNotice("素材理解任务已提交");
      await refetch();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "任务提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mu-page" onMouseDown={(event) => event.target === event.currentTarget && setPanel(undefined)}>
      <div className="mu-workbench">
        <PromptWorkbench
          expanded={expanded}
          references={references}
          prompt={prompt}
          placeholder="请输入问题，帮你深入解答"
          inputLabel="素材理解问题"
          inputRef={inputRef}
          fileInputRef={fileInputRef}
          onChooseFiles={(files) => void chooseFiles(files)}
          onRemoveReference={(id) => setReferences((current) => current.filter((item) => item.id !== id))}
          onPromptChange={setPrompt}
          onExpandedChange={setExpanded}
          onSubmit={() => void submit()}
          submitting={uploading || submitting}
          controls={
            <>
              <button onClick={() => setPanel(panel === "model" ? undefined : "model")}>
                <Box />
                {models.find((item) => item.id === model)?.name}
                <ChevronDown />
              </button>
              <button onClick={() => setPanel(panel === "reasoning" ? undefined : "reasoning")}>
                思考深度: {reasoningOptions.find((item) => item.id === reasoning)?.label}
                <ChevronDown />
              </button>
            </>
          }
        >
          {panel === "model" && (
            <div className="ag-popover mu-model-panel">
              <h3>理解模型</h3>
              {models.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setModel(item.id);
                    setPanel(undefined);
                  }}
                >
                  <span>
                    <b>{item.name}</b>
                    <small>{item.description}</small>
                  </span>
                  {model === item.id && <Check />}
                </button>
              ))}
            </div>
          )}
          {panel === "reasoning" && (
            <div className="ag-popover mu-reasoning-panel">
              <h3>思考深度</h3>
              {reasoningOptions.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setReasoning(item.id);
                    setPanel(undefined);
                  }}
                >
                  {item.label}
                  {reasoning === item.id && <Check />}
                </button>
              ))}
            </div>
          )}
        </PromptWorkbench>
        {(uploading || submitting) && (
          <div className="mu-loading">
            <LoaderCircle />
            {uploading ? "正在上传素材…" : "正在提交理解任务…"}
          </div>
        )}
        {notice && (
          <button className="mu-notice" onClick={() => setNotice("")}>
            {notice}
            <X />
          </button>
        )}
      </div>

      {!!tasks.length && (
        <section className="mu-tasks">
          <header>
            <div>
              <span>MATERIAL INSIGHTS</span>
              <h2>最近理解</h2>
            </div>
            <small>{tasks.length} 个任务</small>
          </header>
          <div>
            {tasks.slice(0, 6).map((task) => (
              <button key={task.id} onClick={() => setSelectedTask(task)}>
                <ScanSearch />
                <span>
                  <b>{task.title}</b>
                  <small>
                    {task.stage} · {task.progress}%
                  </small>
                </span>
                <i className={task.status}>
                  {task.status === "succeeded" ? "已完成" : task.status === "failed" ? "失败" : "处理中"}
                </i>
              </button>
            ))}
          </div>
        </section>
      )}

      {selectedTask && (
        <div className="mu-result-mask" onMouseDown={() => setSelectedTask(null)}>
          <section onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <h2>素材理解结果</h2>
              <button onClick={() => setSelectedTask(null)}>
                <X />
              </button>
            </header>
            <pre>{resultText(selectedTask)}</pre>
          </section>
        </div>
      )}
    </main>
  );
}

function resultText(task: Job) {
  const result = task.result as ApiJobResult | undefined;
  return (
    result?.artifacts.find((artifact) => artifact.text)?.text ||
    result?.summary ||
    task.error?.message ||
    "任务仍在处理中"
  );
}
