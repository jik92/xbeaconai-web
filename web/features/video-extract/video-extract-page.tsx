import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { Download, FolderOpen, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createShareImport, fetchAssetFolders, fetchJobs, parseShareContent, submitJob } from "@/api/api-client";
import type { ShareCandidate } from "@/api/api-client";
import { listJobs } from "@/api/generated/sdk.gen";
import type { Job } from "@/api/generated/types.gen";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ToolCreatorModal } from "@/components/domain/tool-creator-modal";
import { createToolTaskLabel, ToolTaskPage } from "@/components/domain/tool-task-page";
import type { TaskSearchFilterValue } from "@/components/domain/task-search-filters";
import { getAuthToken } from "@/features/account/auth-context";
import { cn } from "@/lib/utils";
import { classifyInput } from "./route-input";
import type { RouteDecision } from "./route-input";

const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  kuaishou: "快手",
  youtube: "YouTube",
  x: "X (Twitter)",
};

const RECOGNITION_ONLY_PLATFORMS = new Set(["kuaishou", "youtube", "x"]);
const jobColumn = createColumnHelper<Job>();
const emptyFilters: TaskSearchFilterValue = { name: "", status: "", from: "", to: "" };

function platformName(job: Job): string {
  const id = job.values?.platformId;
  return id ? (PLATFORM_LABELS[id] ?? id) : "分享导入";
}

function isShareImport(job: Job): boolean {
  return job.moduleId === "share-content-import" || job.moduleId === "douyin-video-import";
}

export function VideoExtractPage() {
  const newTaskLabel = createToolTaskLabel("视频提取");
  const queryClient = useQueryClient();
  const folders = useQuery({ queryKey: ["asset-folders"], queryFn: fetchAssetFolders });
  const [folderId, setFolderId] = useState("");

  // ── Dual job queries ────────────────────────────────────────────────
  const veJobs = useQuery({ queryKey: ["jobs", "video-extract"], queryFn: () => fetchJobs("video-extract") });
  const siJobs = useQuery({
    queryKey: ["jobs", "share-content-import"],
    queryFn: async () => {
      const token = getAuthToken();
      if (!token) throw new Error("请先登录");
      const { data } = await listJobs({
        query: { moduleId: "share-content-import" as never },
        headers: { Authorization: `Bearer ${token}` },
        throwOnError: true,
      });
      return data?.jobs ?? [];
    },
  });

  const allJobs = useMemo(() => {
    const ve = veJobs.data ?? [];
    const si = siJobs.data ?? [];
    return [...ve, ...si].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [veJobs.data, siJobs.data]);

  // ── Unified "new task" dialog state ─────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Candidate selection (only shown when multiple candidates)
  const [candidates, setCandidates] = useState<ShareCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<ShareCandidate | null>(null);
  const [filters, setFilters] = useState(emptyFilters);

  useEffect(() => {
    if (!folderId && folders.data?.length)
      setFolderId(folders.data.find((folder) => folder.isDefault)?.id ?? folders.data[0]!.id);
  }, [folderId, folders.data]);

  // Poll both job lists
  useEffect(() => {
    const timer = window.setInterval(() => {
      void veJobs.refetch();
      void siJobs.refetch();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [veJobs.refetch, siJobs.refetch]);

  // ── Reset dialog ────────────────────────────────────────────────────

  function resetDialog() {
    setInputText("");
    setParsing(false);
    setSubmitting(false);
    setError("");
    setCandidates([]);
    setSelectedCandidate(null);
  }

  function openDialog() {
    resetDialog();
    setDialogOpen(true);
  }

  function closeDialog() {
    resetDialog();
    setDialogOpen(false);
  }

  // ── Submit: parse → classify → route ───────────────────────────────

  async function handleSubmit() {
    const trimmed = inputText.trim();
    if (!trimmed) {
      setError("请输入分享内容、链接或视频 URL");
      return;
    }

    setError("");
    setParsing(true);
    setCandidates([]);
    setSelectedCandidate(null);

    let parsed: ShareCandidate[] = [];
    try {
      parsed = await parseShareContent(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "内容解析失败");
      setParsing(false);
      return;
    }
    setParsing(false);

    const decision = classifyInput(parsed, trimmed);

    await executeDecision(decision);
  }

  async function executeDecision(decision: RouteDecision) {
    if (decision.kind === "empty") {
      setError("请输入分享内容、链接或视频 URL");
      return;
    }

    if (decision.kind === "invalid") {
      setError(decision.reason);
      return;
    }

    if (decision.kind === "multi-candidate") {
      setCandidates(decision.candidates);
      return;
    }

    if (decision.kind === "share-import") {
      await submitShareImport(decision.candidate);
      return;
    }

    // video-extract
    await submitVideoExtract(decision.url);
  }

  async function submitShareImport(candidate: ShareCandidate) {
    setError("");
    setSubmitting(true);
    try {
      await createShareImport(candidate, folderId);
      closeDialog();
      void siJobs.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建导入任务失败");
      setSubmitting(false);
    }
  }

  async function submitVideoExtract(url: string) {
    setError("");
    setSubmitting(true);
    try {
      await submitJob("video-extract", "视频提取", { url, outputFolderId: folderId });
      closeDialog();
      void veJobs.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "任务创建失败");
      setSubmitting(false);
    }
  }

  function handleCandidateConfirm() {
    if (!selectedCandidate) return;
    void submitShareImport(selectedCandidate);
  }

  // ── Job result renderer ─────────────────────────────────────────────

  function renderJobResult(job: Job) {
    if (!isShareImport(job)) {
      if (job.result?.artifacts?.length) {
        return (
          <a href="/assets/materials" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            <FolderOpen size={12} /> 查看素材
          </a>
        );
      }
      return <span className="text-xs text-muted">—</span>;
    }

    const platformId = job.values?.platformId ?? "";

    if (job.status === "succeeded" || job.status === "partially_succeeded") {
      return (
        <a href="/assets/materials" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          <FolderOpen size={12} /> 已保存到素材库
        </a>
      );
    }

    if (job.status === "failed") {
      if (platformId && RECOGNITION_ONLY_PLATFORMS.has(platformId)) {
        return <span className="text-xs text-warning">暂不支持下载</span>;
      }
      const msg = job.error?.message ?? "";
      if (msg.includes("不支持") || msg.includes("not supported")) {
        return <span className="text-xs text-warning">暂不支持下载</span>;
      }
      return <span className="text-xs text-danger">{msg || "导入失败"}</span>;
    }

    if (job.status === "cancelled") {
      return <span className="text-xs text-muted">已取消</span>;
    }

    return <span className="text-xs text-muted">—</span>;
  }

  const showCandidateStep = candidates.length > 0 && !submitting;
  const filteredJobs = allJobs.filter(
    (job) =>
      (!filters.name || job.title.toLowerCase().includes(filters.name.toLowerCase())) &&
      (!filters.status || job.status === filters.status) &&
      (!filters.from || new Date(job.createdAt) >= new Date(`${filters.from}T00:00:00`)) &&
      (!filters.to || new Date(job.createdAt) <= new Date(`${filters.to}T23:59:59.999`)),
  );
  const columns = [
    jobColumn.accessor("title", {
      header: "任务名称",
      size: 300,
      cell: (info) => (
        <div className="flex min-w-0 items-center gap-2">
          {isShareImport(info.row.original) ? (
            <span className="shrink-0 rounded-full bg-surface-muted px-2 py-1 text-2xs text-muted">
              {platformName(info.row.original)}
            </span>
          ) : (
            <Download className="size-4 shrink-0 text-muted" />
          )}
          <span className="truncate font-medium text-ink">{info.getValue()}</span>
        </div>
      ),
    }),
    jobColumn.accessor("status", {
      header: "状态",
      size: 150,
      cell: (info) => (
        <div className="min-w-0">
          <span>{info.row.original.stage}</span>
          {info.row.original.error?.message && !isShareImport(info.row.original) && (
            <small className="block truncate text-2xs text-red-600" title={info.row.original.error.message}>
              {info.row.original.error.message}
            </small>
          )}
        </div>
      ),
    }),
    jobColumn.accessor("progress", {
      header: "进度",
      size: 150,
      cell: (info) => (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-muted">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${info.getValue()}%` }} />
          </div>
          <span className="text-2xs text-muted">{info.getValue()}%</span>
        </div>
      ),
    }),
    jobColumn.display({
      id: "result",
      header: "结果",
      size: 220,
      cell: (info) => renderJobResult(info.row.original),
    }),
    jobColumn.accessor("createdAt", {
      header: "创建时间",
      size: 190,
      cell: (info) => new Date(info.getValue()).toLocaleString(),
    }),
  ] as ColumnDef<Job, unknown>[];

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <>
      <ToolTaskPage
        actionLabel={newTaskLabel}
        onAction={openDialog}
        onSearch={setFilters}
        count={filteredJobs.length}
        totalCount={allJobs.length}
      >
        <DataTable
          className="min-h-0 flex-1"
          columns={columns}
          data={filteredJobs}
          getRowId={(job) => job.id}
          loading={veJobs.isLoading || siJobs.isLoading}
          error={veJobs.error || siJobs.error}
          emptyMessage={allJobs.length ? "没有符合条件的任务" : "暂无任务"}
          emptyAction={!allJobs.length ? <Button onClick={openDialog}>{newTaskLabel}</Button> : undefined}
          height="100%"
        />
      </ToolTaskPage>
      <ToolCreatorModal open={dialogOpen} title={newTaskLabel} onClose={closeDialog}>
        {!showCandidateStep ? (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 text-sm">
              <Label className="flex-col items-start text-xs text-muted">
                <span>
                  分享内容或视频链接 <b className="text-red-500">*</b>
                </span>
                <textarea
                  className="min-h-24 w-full resize-y rounded-md border border-line bg-transparent p-3 text-sm text-ink outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                  value={inputText}
                  maxLength={4096}
                  rows={4}
                  onChange={(event) => setInputText(event.target.value)}
                  placeholder="粘贴分享链接、复制文案或直接视频 URL"
                />
              </Label>
              <Label className="flex-col items-start text-xs text-muted">
                目标存储文件夹
                <NativeSelect required value={folderId} onChange={(event) => setFolderId(event.target.value)}>
                  {folders.data?.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </NativeSelect>
              </Label>
              {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
            </div>
            <footer className="flex h-13 flex-none items-center justify-end gap-2 border-t border-line px-4">
              <Button size="sm" variant="outline" onClick={closeDialog}>
                取消
              </Button>
              <Button
                size="sm"
                disabled={inputText.trim().length === 0 || parsing || submitting}
                onClick={() => void handleSubmit()}
              >
                {(parsing || submitting) && <Loader2 className="animate-spin" />}
                {parsing ? "解析中…" : submitting ? "提交中…" : "开始提取"}
              </Button>
            </footer>
          </>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 text-sm">
              <Label className="flex-col items-start text-xs text-muted">
                检测到多个分享链接，请选择要导入的内容
                <div className="grid w-full gap-2">
                  {candidates.map((candidate, index) => (
                    <button
                      type="button"
                      key={`${candidate.platformId}-${index}`}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md border border-line px-3 py-2 text-left text-xs",
                        selectedCandidate?.raw === candidate.raw && "border-primary bg-surface-muted",
                      )}
                      onClick={() => setSelectedCandidate(candidate)}
                    >
                      <span className="rounded-full bg-surface-muted px-2 py-1 text-2xs">
                        {PLATFORM_LABELS[candidate.platformId] ?? candidate.platformId}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{candidate.label}</span>
                      <span className="text-2xs text-muted">
                        {candidate.confidence === "high"
                          ? "高置信"
                          : candidate.confidence === "medium"
                            ? "中置信"
                            : "低置信"}
                      </span>
                    </button>
                  ))}
                </div>
              </Label>
              <Label className="flex-col items-start text-xs text-muted">
                保存到文件夹
                <NativeSelect value={folderId} onChange={(event) => setFolderId(event.target.value)}>
                  {folders.data?.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </NativeSelect>
              </Label>
              {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
            </div>
            <footer className="flex h-13 flex-none items-center justify-end gap-2 border-t border-line px-4">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setCandidates([]);
                  setSelectedCandidate(null);
                  setError("");
                }}
              >
                重新输入
              </Button>
              <Button size="sm" disabled={!selectedCandidate || submitting} onClick={handleCandidateConfirm}>
                {submitting && <Loader2 className="animate-spin" />}
                {submitting ? "提交中…" : "开始导入"}
              </Button>
            </footer>
          </>
        )}
      </ToolCreatorModal>
    </>
  );
}
