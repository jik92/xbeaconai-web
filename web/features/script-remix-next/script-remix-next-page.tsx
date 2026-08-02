import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  History,
  ImageIcon,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCcw,
  Sparkles,
  Upload,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  composeScriptRemixNext,
  createScriptRemixNext,
  downloadAuthenticated,
  fetchJobs,
  fetchLibraryAssets,
  generateScriptRemixNextReferenceImage,
  generateScriptRemixNextShot,
  generateScriptRemixNextStoryboard,
  regenerateScriptRemixNext,
  saveScriptRemixNext,
  uploadLibraryAsset,
} from "@/api/api-client";
import type { Job } from "@/api/generated/types.gen";
import { AttachmentPicker } from "@/components/domain/attachment-picker";
import { AuthenticatedMedia } from "@/components/domain/authenticated-media";
import { DashedPickerTile } from "@/components/domain/dashed-picker-tile";
import { FileUpload } from "@/components/domain/file-upload";
import { MediaResultCard } from "@/components/domain/media-result-card";
import { ProductImage } from "@/components/domain/product-image";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Switch } from "@/components/ui/switch";
import type { LibraryAsset, LibraryProduct } from "@/entities/types";
import { fetchPortraits, type Portrait } from "@/features/portrait-library/portrait-data";
import { ProductPickerModal } from "@/features/video-remix/remix-project";
import {
  createScriptRemixNextWorkspace,
  type ScriptRemixNextShot,
  type ScriptRemixNextWorkspace,
  scriptRemixNextCompletePrompt,
  scriptRemixNextReadyToCompose,
  scriptRemixNextShotSettings,
} from "../../../shared/script-remix-next/workflow";

const stages = ["上传配置", "生成分镜稿件", "分镜校对", "合并生成"];

function parseJson<T>(value: string | undefined, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function jobArtifact(job: Job | undefined, mimePrefix: string) {
  return job?.result?.artifacts.find((artifact) => artifact.mimeType.startsWith(mimePrefix));
}

export function ScriptRemixNextPage() {
  const queryClient = useQueryClient();
  const handledJobs = useRef(new Set<string>());
  const [projectId, setProjectId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [scriptInputMode, setScriptInputMode] = useState<"text" | "upload">("text");
  const [scriptContent, setScriptContent] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<LibraryProduct | null>(null);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [selectedPortrait, setSelectedPortrait] = useState<Portrait | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<LibraryAsset | null>(null);
  const [workspace, setWorkspace] = useState<ScriptRemixNextWorkspace>(createScriptRemixNextWorkspace);
  const [notice, setNotice] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");
  const [storyboardJobId, setStoryboardJobId] = useState("");
  const [composeJobId, setComposeJobId] = useState("");
  const [composeInvalidated, setComposeInvalidated] = useState(false);

  const jobsQuery = useQuery({
    queryKey: ["script-remix-next-jobs"],
    queryFn: () => fetchJobs("script-remix-next"),
    refetchInterval: (query) =>
      query.state.data?.some((job) => job.status === "queued" || job.status === "processing") ? 2_500 : false,
  });
  const portraitsQuery = useQuery({ queryKey: ["portrait-library"], queryFn: fetchPortraits, staleTime: Infinity });
  const voicesQuery = useQuery({
    queryKey: ["asset-library", "voice"],
    queryFn: () => fetchLibraryAssets("voice"),
    staleTime: 30_000,
  });
  const jobs = jobsQuery.data ?? [];
  const roots = jobs.filter((job) => !job.parentJobId && job.values.workflowPhase === "analysis");
  const project = roots.find((job) => job.id === projectId);
  const children = jobs.filter((job) => job.parentJobId === projectId);
  const storyboardJob =
    jobs.find((job) => job.id === storyboardJobId) ??
    children.filter((job) => job.values.workflowPhase === "storyboard").at(-1);
  const composeJob =
    jobs.find((job) => job.id === composeJobId) ??
    children.filter((job) => job.values.workflowPhase === "compose").at(-1);
  const busy = jobs.some((job) => job.status === "queued" || job.status === "processing");

  const saveWorkspace = useCallback(
    async (next: ScriptRemixNextWorkspace) => {
      setWorkspace(next);
      if (projectId) await saveScriptRemixNext(projectId, { workspace: next });
    },
    [projectId],
  );

  useEffect(() => {
    if (!project || handledJobs.current.has(project.id) || project.status !== "succeeded") return;
    const shots = parseJson<ScriptRemixNextShot[]>(project.values.shots, []);
    const saved = parseJson<ScriptRemixNextWorkspace>(project.values.workspaceState, createScriptRemixNextWorkspace());
    setWorkspace({
      ...saved,
      shots: saved.shots.length ? saved.shots : shots,
      composeOrder: saved.composeOrder.length ? saved.composeOrder : shots.map((shot) => shot.id),
    });
    setProjectName(project.title);
    handledJobs.current.add(project.id);
  }, [project]);

  useEffect(() => {
    const job = children.find((item) => item.status === "succeeded" && !handledJobs.current.has(item.id));
    if (!job) return;
    if (job.values.workflowPhase === "analysis") {
      const shots = parseJson<ScriptRemixNextShot[]>(job.values.shots, []);
      const next = {
        ...workspace,
        stage: 0 as const,
        shots,
        analysisVersion: workspace.analysisVersion + 1,
        storyboardAssetId: "",
        storyboardVersion: 0,
        referenceAssetIds: {},
        selectedVideoAssetIds: {},
        composeOrder: shots.map((shot) => shot.id),
      };
      void saveWorkspace(next);
    } else if (job.values.workflowPhase === "reference-image") {
      const ids = parseJson<Record<string, string>>(job.values.cellAssetIds, {});
      void saveWorkspace({ ...workspace, referenceAssetIds: { ...workspace.referenceAssetIds, ...ids } });
    } else if (job.values.workflowPhase === "shot-generation") {
      const artifact = jobArtifact(job, "video/");
      const shotId = job.values.sourceAssetId;
      if (artifact && shotId)
        void saveWorkspace({
          ...workspace,
          selectedVideoAssetIds: { ...workspace.selectedVideoAssetIds, [shotId]: artifact.id },
        });
    }
    handledJobs.current.add(job.id);
  }, [children, saveWorkspace, workspace]);

  useEffect(() => {
    const failed = jobs.find((job) => job.status === "failed" && !handledJobs.current.has(job.id));
    if (!failed) return;
    setNotice(typeof failed.error === "string" ? failed.error : failed.error?.message || `${failed.title}失败`);
    handledJobs.current.add(failed.id);
  }, [jobs]);

  const createProject = useMutation({
    mutationFn: async () => {
      if (!selectedProduct) throw new Error("请选择商品");
      if (scriptInputMode === "text" && scriptContent.trim().length < 20) throw new Error("请至少输入 20 个字符的脚本");
      if (scriptInputMode === "upload" && !documentFile) throw new Error("请选择脚本文档");
      const document =
        scriptInputMode === "upload" && documentFile
          ? await uploadLibraryAsset(documentFile, "media", documentFile.name.replace(/\.[^.]+$/, ""))
          : undefined;
      return createScriptRemixNext({
        projectName: projectName.trim() || `${selectedProduct.name}脚本二创`,
        ...(document ? { documentAssetId: document.id } : { scriptContent: scriptContent.trim() }),
        productName: selectedProduct.name,
        productDescription: selectedProduct.description || "",
        productImageAssetIds: selectedProduct.images.map((image) => image.id),
        ...(selectedPortrait?.type === "custom" ? { portraitAssetId: selectedPortrait.assetId } : {}),
        ...(selectedPortrait ? { portraitReference: selectedPortrait.reference } : {}),
        portraitName: selectedPortrait?.name || "",
        voiceAssetId: selectedVoice?.id,
        voiceName: selectedVoice?.name || "",
      });
    },
    onSuccess: (job) => {
      setProjectId(job.id);
      void queryClient.invalidateQueries({ queryKey: ["script-remix-next-jobs"] });
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : "项目创建失败"),
  });

  const patchShot = (shotId: string, patch: Partial<ScriptRemixNextShot>) =>
    setWorkspace((current) => ({
      ...current,
      shots: current.shots.map((shot) => (shot.id === shotId ? { ...shot, ...patch } : shot)),
    }));

  const storyboardArtifact = jobArtifact(storyboardJob, "image/");
  const composeArtifact = composeInvalidated ? undefined : jobArtifact(composeJob, "video/");

  const submitShot = useCallback(
    async (shot: ScriptRemixNextShot) => {
      const referenceAssetId = workspace.referenceAssetIds[shot.id];
      if (!referenceAssetId) return;
      try {
        await generateScriptRemixNextShot({
          projectId,
          shot,
          settings: scriptRemixNextShotSettings(workspace, shot.id) as Parameters<
            typeof generateScriptRemixNextShot
          >[0]["settings"],
          referenceAssetId,
          extraReferenceAssetIds: [],
        });
        await queryClient.invalidateQueries({ queryKey: ["script-remix-next-jobs"] });
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "视频生成提交失败");
      }
    },
    [projectId, queryClient, workspace],
  );

  const columns = useMemo<ColumnDef<ScriptRemixNextShot, unknown>[]>(
    () => [
      { header: "分镜", size: 80, cell: ({ row }) => <b>{String(row.original.ordinal).padStart(2, "0")}</b> },
      {
        header: "参考图",
        size: 120,
        cell: ({ row }) => {
          const assetId = workspace.referenceAssetIds[row.original.id];
          return (
            <div className="flex items-center gap-1">
              {assetId ? (
                <AuthenticatedMedia
                  className="size-12 rounded-md object-cover"
                  url={`/api/assets/${assetId}/access`}
                  mimeType="image/png"
                  alt={row.original.title}
                  previewable
                />
              ) : (
                <span className="flex size-12 items-center justify-center rounded-md bg-surface-muted text-muted">
                  <ImageIcon />
                </span>
              )}
              <AttachmentPicker
                accept="image/*"
                trigger={(open) => (
                  <Button size="icon-sm" variant="ghost" aria-label={`选择${row.original.title}参考图`} onClick={open}>
                    <Upload />
                  </Button>
                )}
                onSelect={(assets) => {
                  const asset = assets[0];
                  if (!asset) return;
                  void saveWorkspace({
                    ...workspace,
                    referenceAssetIds: { ...workspace.referenceAssetIds, [row.original.id]: asset.id },
                  });
                }}
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`重新生成${row.original.title}参考图`}
                disabled={busy}
                onClick={async () => {
                  try {
                    await generateScriptRemixNextReferenceImage({ projectId, shot: row.original });
                    await queryClient.invalidateQueries({ queryKey: ["script-remix-next-jobs"] });
                  } catch (error) {
                    setNotice(error instanceof Error ? error.message : "参考图生成失败");
                  }
                }}
              >
                <RefreshCcw />
              </Button>
            </div>
          );
        },
      },
      {
        header: "文案 / 画面",
        size: 320,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col gap-1 whitespace-normal">
            <b>{row.original.title}</b>
            <span className="line-clamp-2 type-helper text-muted">{row.original.speech}</span>
          </div>
        ),
      },
      {
        header: "生成参数",
        size: 220,
        cell: ({ row }) => {
          const settings = scriptRemixNextShotSettings(workspace, row.original.id);
          return (
            <div className="flex flex-wrap gap-1">
              <select
                aria-label={`${row.original.title}模型`}
                value={settings.modelId}
                onChange={(event) =>
                  setWorkspace((current) => ({
                    ...current,
                    shotVideoSettings: {
                      ...current.shotVideoSettings,
                      [row.original.id]: {
                        ...current.shotVideoSettings[row.original.id],
                        modelId: event.target.value as ScriptRemixNextWorkspace["globalVideoSettings"]["modelId"],
                      },
                    },
                  }))
                }
              >
                <option value="doubao-seedance-2-0-260128">2.0</option>
                <option value="doubao-seedance-2-0-mini-260615">Mini</option>
                <option value="doubao-seedance-2-0-fast-260128">Fast</option>
              </select>
              <select
                aria-label={`${row.original.title}比例`}
                value={settings.ratio}
                onChange={(event) =>
                  setWorkspace((current) => ({
                    ...current,
                    shotVideoSettings: {
                      ...current.shotVideoSettings,
                      [row.original.id]: { ...current.shotVideoSettings[row.original.id], ratio: event.target.value },
                    },
                  }))
                }
              >
                <option>9:16</option>
                <option>16:9</option>
                <option>1:1</option>
              </select>
              <select
                aria-label={`${row.original.title}分辨率`}
                value={settings.resolution}
                onChange={(event) =>
                  setWorkspace((current) => ({
                    ...current,
                    shotVideoSettings: {
                      ...current.shotVideoSettings,
                      [row.original.id]: {
                        ...current.shotVideoSettings[row.original.id],
                        resolution: event.target.value,
                      },
                    },
                  }))
                }
              >
                <option>720p</option>
                <option>1080p</option>
              </select>
              <select
                aria-label={`${row.original.title}时长`}
                value={settings.duration}
                onChange={(event) =>
                  setWorkspace((current) => ({
                    ...current,
                    shotVideoSettings: {
                      ...current.shotVideoSettings,
                      [row.original.id]: {
                        ...current.shotVideoSettings[row.original.id],
                        duration: Number(event.target.value),
                      },
                    },
                  }))
                }
              >
                {[4, 5, 6, 8, 10, 12, 15].map((value) => (
                  <option key={value} value={value}>
                    {value}秒
                  </option>
                ))}
              </select>
            </div>
          );
        },
      },
      {
        header: "视频版本",
        size: 150,
        cell: ({ row }) => {
          const shotJobs = children.filter(
            (job) =>
              job.values.workflowPhase === "shot-generation" &&
              job.values.sourceAssetId === row.original.id &&
              job.status === "succeeded",
          );
          const selected = workspace.selectedVideoAssetIds[row.original.id] || "";
          return (
            <select
              aria-label={`${row.original.title}视频版本`}
              value={selected}
              onChange={(event) =>
                void saveWorkspace({
                  ...workspace,
                  selectedVideoAssetIds: { ...workspace.selectedVideoAssetIds, [row.original.id]: event.target.value },
                })
              }
            >
              <option value="">未生成</option>
              {shotJobs.flatMap(
                (job, index) =>
                  job.result?.artifacts
                    .filter((artifact) => artifact.mimeType.startsWith("video/"))
                    .map((artifact) => (
                      <option key={artifact.id} value={artifact.id}>
                        版本 {index + 1}
                      </option>
                    )) ?? [],
              )}
            </select>
          );
        },
      },
      {
        header: "操作",
        size: 100,
        cell: ({ row }) => (
          <Button
            size="sm"
            disabled={busy || !workspace.referenceAssetIds[row.original.id]}
            onClick={() => void submitShot(row.original)}
          >
            <Video />
            生成
          </Button>
        ),
      },
    ],
    [busy, children, projectId, queryClient, saveWorkspace, submitShot, workspace],
  );

  const reset = () => {
    setProjectId("");
    setProjectName("");
    setDocumentFile(null);
    setScriptInputMode("text");
    setScriptContent("");
    setSelectedProduct(null);
    setSelectedPortrait(null);
    setSelectedVoice(null);
    setWorkspace(createScriptRemixNextWorkspace());
    setStoryboardJobId("");
    setComposeJobId("");
    setComposeInvalidated(false);
    setNotice("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="remix-header">
        <div className="remix-brand">
          <FileText />
          脚本二创【新】
        </div>
        <ol className="remix-steps" aria-label="创作进度">
          {stages.map((label, index) => (
            <li
              key={label}
              className={index === workspace.stage ? "active" : index < workspace.stage ? "done" : ""}
              aria-current={index === workspace.stage ? "step" : undefined}
            >
              <i>{index < workspace.stage ? <Check /> : index + 1}</i>
              <span>{label}</span>
              {index < stages.length - 1 && <ChevronRight className="step-arrow" />}
            </li>
          ))}
        </ol>
        <div className="remix-header-actions">
          <Button
            size="sm"
            variant="outline"
            disabled={workspace.stage === 0}
            onClick={() =>
              void saveWorkspace({ ...workspace, stage: Math.max(0, workspace.stage - 1) as 0 | 1 | 2 | 3 })
            }
          >
            <ChevronLeft />
            上一步
          </Button>
          <Button size="sm" variant="outline" onClick={() => setHistoryOpen((open) => !open)}>
            <History />
            生成记录
          </Button>
          <Button size="sm" variant="ghost" onClick={reset}>
            <Plus />
            新建
          </Button>
        </div>
      </header>
      {notice && (
        <Button className="m-2 self-center text-error" variant="ghost" onClick={() => setNotice("")}>
          {notice}
        </Button>
      )}
      <div className="relative flex min-h-0 flex-1">
        {historyOpen && (
          <aside className="absolute right-3 top-3 z-20 flex max-h-[70vh] w-80 flex-col gap-1 overflow-y-auto rounded-xl border border-line bg-surface p-2 shadow-sm">
            <div className="flex gap-1">
              <input
                className="h-8 min-w-0 flex-1 rounded-md border border-line px-2 type-helper"
                value={historyQuery}
                placeholder="搜索项目"
                onChange={(event) => setHistoryQuery(event.target.value)}
              />
              <select
                aria-label="项目状态"
                value={historyStatus}
                onChange={(event) => setHistoryStatus(event.target.value)}
              >
                <option value="">全部</option>
                <option value="queued">排队中</option>
                <option value="processing">处理中</option>
                <option value="succeeded">已完成</option>
                <option value="failed">失败</option>
              </select>
            </div>
            {roots
              .filter(
                (root) =>
                  (!historyQuery || root.title.toLocaleLowerCase().includes(historyQuery.toLocaleLowerCase())) &&
                  (!historyStatus || root.status === historyStatus),
              )
              .map((root) => (
                <div className="flex items-center gap-1" key={root.id}>
                  <Button
                    className="h-auto min-w-0 flex-1 justify-start py-2 text-left"
                    variant={root.id === projectId ? "outline" : "ghost"}
                    onClick={() => {
                      setProjectId(root.id);
                      handledJobs.current.delete(root.id);
                      setHistoryOpen(false);
                    }}
                  >
                    <span className="min-w-0">
                      <b className="block truncate">{root.title}</b>
                      <small className="type-helper text-muted">{root.stage}</small>
                    </span>
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`重命名${root.title}`}
                    onClick={async () => {
                      const title = window.prompt("项目名称", root.title)?.trim();
                      if (!title || title === root.title) return;
                      await saveScriptRemixNext(root.id, { title });
                      await queryClient.invalidateQueries({ queryKey: ["script-remix-next-jobs"] });
                    }}
                  >
                    <Pencil />
                  </Button>
                </div>
              ))}
          </aside>
        )}

        {workspace.stage === 0 && (
          <>
            <aside className="w-80 flex-none overflow-y-auto border-r border-line bg-surface p-4">
              <div className="flex flex-col gap-4">
                <label className="flex flex-col gap-1 type-label">
                  项目名称
                  <input
                    className="h-9 rounded-md border border-line px-3 type-body"
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                  />
                </label>
                <div className="flex items-center justify-between gap-2 type-label">
                  <span>{scriptInputMode === "upload" ? "上传脚本文档" : "直接添加脚本"}</span>
                  <span className="flex items-center gap-2 type-helper text-muted">
                    上传文档
                    <Switch
                      checked={scriptInputMode === "upload"}
                      onCheckedChange={(checked) => setScriptInputMode(checked ? "upload" : "text")}
                      aria-label="切换脚本输入方式"
                    />
                  </span>
                </div>
                {scriptInputMode === "upload" ? (
                  <FileUpload
                    label="脚本文档"
                    accept=".txt,.md,text/plain,text/markdown"
                    files={documentFile ? [documentFile] : []}
                    description="TXT 或 Markdown，不超过 2MB"
                    onFilesChange={(files) => setDocumentFile(files[0] || null)}
                    onClear={() => setDocumentFile(null)}
                  />
                ) : (
                  <textarea
                    className="min-h-40 w-full resize-y rounded-md border border-line bg-surface px-3 py-2 type-body"
                    value={scriptContent}
                    maxLength={12_000}
                    placeholder="粘贴或输入完整脚本"
                    aria-label="直接添加脚本"
                    onChange={(event) => setScriptContent(event.target.value)}
                  />
                )}
                <div className="config-field-title">
                  <b>商品 *</b>
                </div>
                <DashedPickerTile
                  presentation="wide"
                  title={selectedProduct?.name || "未选择商品"}
                  description={selectedProduct ? `${selectedProduct.images.length} 张商品图` : undefined}
                  icon={<Plus />}
                  preview={
                    selectedProduct ? (
                      <ProductImage
                        url={selectedProduct.images[0]?.thumbnailUrl || ""}
                        originalUrl={selectedProduct.images[0]?.originalUrl}
                        mimeType={selectedProduct.images[0]?.mimeType || "image/png"}
                        alt={selectedProduct.name}
                      />
                    ) : undefined
                  }
                  aria-label={selectedProduct ? "更换商品" : "选择商品"}
                  onClick={() => setProductPickerOpen(true)}
                />
                <label className="flex flex-col gap-1 type-label">
                  虚拟人像（选填）
                  <select
                    value={selectedPortrait?.key || ""}
                    onChange={(event) =>
                      setSelectedPortrait(portraitsQuery.data?.find((item) => item.key === event.target.value) || null)
                    }
                  >
                    <option value="">自动虚拟人像</option>
                    {portraitsQuery.data
                      ?.filter((portrait) => portrait.status === "active")
                      .map((portrait) => (
                        <option key={portrait.key} value={portrait.key}>
                          {portrait.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 type-label">
                  音色（选填）
                  <select
                    value={selectedVoice?.id || ""}
                    onChange={(event) =>
                      setSelectedVoice(voicesQuery.data?.find((item) => item.id === event.target.value) || null)
                    }
                  >
                    <option value="">不使用音色</option>
                    {voicesQuery.data?.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name}
                      </option>
                    ))}
                  </select>
                </label>
                {!projectId && (
                  <Button
                    disabled={
                      createProject.isPending ||
                      !selectedProduct ||
                      (scriptInputMode === "upload" ? !documentFile : scriptContent.trim().length < 20)
                    }
                    onClick={() => createProject.mutate()}
                  >
                    {createProject.isPending ? <LoaderCircle className="animate-spin" /> : <Sparkles />}脚本解析
                  </Button>
                )}
              </div>
            </aside>
            <section className="flex min-w-0 flex-1 flex-col overflow-hidden p-4">
              {!workspace.shots.length ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted">
                  {busy ? <LoaderCircle className="size-10 animate-spin" /> : <FileText className="size-10" />}
                  <b>{busy ? "正在使用 gpt-5.6-sol 解析脚本" : "上传配置后开始解析"}</b>
                </div>
              ) : (
                <>
                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                    {workspace.shots.map((shot) => (
                      <article
                        key={shot.id}
                        className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-surface p-3"
                      >
                        <b className="col-span-2">分镜 {shot.ordinal}</b>
                        <label className="flex min-w-0 flex-col gap-1 type-label text-muted">
                          分镜标题
                          <input
                            className="h-9 rounded-md border border-line bg-surface px-3 type-body text-ink"
                            value={shot.title}
                            aria-label={`分镜 ${shot.ordinal} 标题`}
                            onChange={(event) => patchShot(shot.id, { title: event.target.value })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1 type-label text-muted">
                          建议时长
                          <span className="relative block">
                            <input
                              className="h-9 w-full rounded-md border border-line bg-surface px-3 pr-9 type-body text-ink"
                              type="number"
                              min={1}
                              max={60}
                              value={shot.durationSeconds}
                              aria-label={`分镜 ${shot.ordinal} 建议时长`}
                              onChange={(event) => patchShot(shot.id, { durationSeconds: Number(event.target.value) })}
                            />
                            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center type-helper text-muted">
                              秒
                            </span>
                          </span>
                        </label>
                        <label className="col-span-2 flex min-w-0 flex-col gap-1 type-label text-muted">
                          <span className="flex items-center justify-between gap-2">
                            <span>完整提示词</span>
                            <span className="type-helper">
                              {scriptRemixNextCompletePrompt(shot).length.toLocaleString()} / 8,000
                            </span>
                          </span>
                          <textarea
                            className="min-h-40 rounded-md border border-line bg-surface px-3 py-2 type-body text-ink"
                            value={scriptRemixNextCompletePrompt(shot)}
                            maxLength={8_000}
                            aria-label={`分镜 ${shot.ordinal} 完整提示词`}
                            onChange={(event) => patchShot(shot.id, { prompt: event.target.value })}
                          />
                        </label>
                      </article>
                    ))}
                  </div>
                  <footer className="flex justify-between pt-3">
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={async () => {
                        if (!projectId) return;
                        const job = await regenerateScriptRemixNext(projectId);
                        await queryClient.invalidateQueries({ queryKey: ["script-remix-next-jobs"] });
                        handledJobs.current.delete(job.id);
                      }}
                    >
                      <RefreshCcw />
                      重新生成
                    </Button>
                    <Button
                      onClick={() => {
                        const hasDownstream = Boolean(
                          workspace.storyboardAssetId || Object.keys(workspace.selectedVideoAssetIds).length,
                        );
                        if (hasDownstream && !window.confirm("继续将使已有九宫格、分镜视频和合片结果失效，是否确认？"))
                          return;
                        setComposeInvalidated(true);
                        void saveWorkspace({
                          ...workspace,
                          stage: 1,
                          analysisVersion: workspace.analysisVersion + 1,
                          storyboardAssetId: "",
                          storyboardVersion: 0,
                          referenceAssetIds: {},
                          selectedVideoAssetIds: {},
                          composeOrder: workspace.shots.map((shot) => shot.id),
                        });
                      }}
                    >
                      下一步
                    </Button>
                  </footer>
                </>
              )}
            </section>
          </>
        )}

        {workspace.stage === 1 && (
          <section className="flex min-w-0 flex-1 flex-col items-center gap-4 overflow-y-auto p-6">
            {storyboardArtifact ? (
              <MediaResultCard
                className="w-full max-w-xl"
                url={storyboardArtifact.url || `/api/assets/${storyboardArtifact.id}/access`}
                mimeType={storyboardArtifact.mimeType}
                name={storyboardArtifact.name}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted">
                {storyboardJob?.status === "queued" || storyboardJob?.status === "processing" ? (
                  <LoaderCircle className="size-10 animate-spin" />
                ) : (
                  <ImageIcon className="size-10" />
                )}
                <b>{storyboardJob?.stage || "生成九宫格分镜稿件"}</b>
              </div>
            )}
            <footer className="flex gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  const job = await generateScriptRemixNextStoryboard({ projectId, shots: workspace.shots });
                  setStoryboardJobId(job.id);
                  await queryClient.invalidateQueries({ queryKey: ["script-remix-next-jobs"] });
                }}
              >
                <RefreshCcw />
                {storyboardArtifact ? "重新生成" : "生成九宫格"}
              </Button>
              <Button
                disabled={storyboardJob?.status !== "succeeded"}
                onClick={() => {
                  const ids = parseJson<Record<string, string>>(storyboardJob?.values.cellAssetIds, {});
                  void saveWorkspace({
                    ...workspace,
                    stage: 2,
                    storyboardAssetId: storyboardArtifact?.id || "",
                    storyboardVersion: workspace.storyboardVersion + 1,
                    referenceAssetIds: ids,
                    selectedVideoAssetIds: {},
                  });
                }}
              >
                确认并进入分镜校对
              </Button>
            </footer>
          </section>
        )}

        {workspace.stage === 2 && (
          <section className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3">
            <div className="flex flex-wrap items-center gap-2">
              <b>全局参数</b>
              <select
                value={workspace.globalVideoSettings.modelId}
                onChange={(event) =>
                  setWorkspace({
                    ...workspace,
                    globalVideoSettings: {
                      ...workspace.globalVideoSettings,
                      modelId: event.target.value as ScriptRemixNextWorkspace["globalVideoSettings"]["modelId"],
                    },
                  })
                }
              >
                <option value="doubao-seedance-2-0-260128">Seedance 2.0</option>
                <option value="doubao-seedance-2-0-mini-260615">Seedance 2.0 Mini</option>
                <option value="doubao-seedance-2-0-fast-260128">Seedance 2.0 Fast</option>
              </select>
              <select
                value={workspace.globalVideoSettings.ratio}
                onChange={(event) =>
                  setWorkspace({
                    ...workspace,
                    globalVideoSettings: { ...workspace.globalVideoSettings, ratio: event.target.value },
                  })
                }
              >
                <option>9:16</option>
                <option>16:9</option>
                <option>1:1</option>
              </select>
              <select
                value={workspace.globalVideoSettings.resolution}
                onChange={(event) =>
                  setWorkspace({
                    ...workspace,
                    globalVideoSettings: { ...workspace.globalVideoSettings, resolution: event.target.value },
                  })
                }
              >
                <option>720p</option>
                <option>1080p</option>
              </select>
              <select
                aria-label="全局视频时长"
                value={workspace.globalVideoSettings.duration}
                onChange={(event) =>
                  setWorkspace({
                    ...workspace,
                    globalVideoSettings: { ...workspace.globalVideoSettings, duration: Number(event.target.value) },
                  })
                }
              >
                {[4, 5, 6, 8, 10, 12, 15].map((value) => (
                  <option key={value} value={value}>
                    {value}秒
                  </option>
                ))}
              </select>
              <Button
                className="ml-auto"
                variant="outline"
                disabled={busy || workspace.shots.every((shot) => Boolean(workspace.selectedVideoAssetIds[shot.id]))}
                onClick={() =>
                  void Promise.all(
                    workspace.shots.filter((shot) => !workspace.selectedVideoAssetIds[shot.id]).map(submitShot),
                  )
                }
              >
                <Video />
                批量生成未完成分镜
              </Button>
            </div>
            <DataTable className="flex-1" columns={columns} data={workspace.shots} getRowId={(shot) => shot.id} />
            <footer className="flex justify-end">
              <Button
                disabled={!scriptRemixNextReadyToCompose(workspace)}
                onClick={() => void saveWorkspace({ ...workspace, stage: 3 })}
              >
                下一步
              </Button>
            </footer>
          </section>
        )}

        {workspace.stage === 3 && (
          <section className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
            <ul className="mx-auto flex w-full max-w-3xl flex-col gap-2">
              {workspace.composeOrder.map((shotId, index) => {
                const shot = workspace.shots.find((item) => item.id === shotId);
                const assetId = workspace.selectedVideoAssetIds[shotId];
                return (
                  <li
                    key={shotId}
                    className="flex items-center gap-2 rounded-lg border border-line bg-surface p-2"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", shotId);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const draggedId = event.dataTransfer.getData("text/plain");
                      const fromIndex = workspace.composeOrder.indexOf(draggedId);
                      if (fromIndex < 0 || fromIndex === index) return;
                      const order = [...workspace.composeOrder];
                      order.splice(fromIndex, 1);
                      order.splice(index, 0, draggedId);
                      setComposeInvalidated(true);
                      setWorkspace({ ...workspace, composeOrder: order });
                    }}
                  >
                    <b className="w-8">{index + 1}</b>
                    <span className="min-w-0 flex-1 truncate">{shot?.title}</span>
                    {assetId && (
                      <AuthenticatedMedia
                        className="h-14 w-20 rounded-md object-cover"
                        url={`/api/assets/${assetId}/access`}
                        mimeType="video/mp4"
                        alt={shot?.title || "分镜"}
                        previewable
                      />
                    )}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={index === 0}
                      onClick={() => {
                        const order = [...workspace.composeOrder];
                        const previous = order[index - 1];
                        const current = order[index];
                        if (!previous || !current) return;
                        order[index - 1] = current;
                        order[index] = previous;
                        setComposeInvalidated(true);
                        setWorkspace({ ...workspace, composeOrder: order });
                      }}
                    >
                      ↑
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={index === workspace.composeOrder.length - 1}
                      onClick={() => {
                        const order = [...workspace.composeOrder];
                        const current = order[index];
                        const next = order[index + 1];
                        if (!current || !next) return;
                        order[index] = next;
                        order[index + 1] = current;
                        setComposeInvalidated(true);
                        setWorkspace({ ...workspace, composeOrder: order });
                      }}
                    >
                      ↓
                    </Button>
                  </li>
                );
              })}
            </ul>
            {composeArtifact ? (
              <MediaResultCard
                className="mx-auto w-full max-w-3xl"
                url={composeArtifact.url || `/api/assets/${composeArtifact.id}/access`}
                mimeType={composeArtifact.mimeType}
                name={composeArtifact.name}
                onDownload={() =>
                  void downloadAuthenticated(
                    composeArtifact.url || `/api/assets/${composeArtifact.id}/access`,
                    composeArtifact.name,
                  )
                }
              />
            ) : (
              <div className="flex justify-center">
                <Button
                  disabled={busy || !scriptRemixNextReadyToCompose(workspace)}
                  onClick={async () => {
                    const job = await composeScriptRemixNext({
                      projectId,
                      workspace: workspace as Parameters<typeof composeScriptRemixNext>[0]["workspace"],
                    });
                    setComposeJobId(job.id);
                    setComposeInvalidated(false);
                    await queryClient.invalidateQueries({ queryKey: ["script-remix-next-jobs"] });
                  }}
                >
                  {composeJob?.status === "queued" || composeJob?.status === "processing" ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Download />
                  )}
                  合并生成
                </Button>
              </div>
            )}
          </section>
        )}
      </div>
      {productPickerOpen && (
        <ProductPickerModal
          current={selectedProduct}
          onClose={() => setProductPickerOpen(false)}
          onSelect={(product) => {
            setSelectedProduct(product);
            setProductPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}
