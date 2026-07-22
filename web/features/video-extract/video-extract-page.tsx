import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, FolderOpen, Loader2, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createShareImport, fetchAssetFolders, fetchJobs, parseShareContent, submitJob } from "@/api/api-client";
import type { ShareCandidate } from "@/api/api-client";
import { listJobs } from "@/api/generated/sdk.gen";
import { getAuthToken } from "@/features/account/auth-context";
import type { Job } from "@/api/generated/types.gen";
import { classifyInput } from "./route-input";
import type { RouteDecision } from "./route-input";
import "./video-extract-page.css";

const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  kuaishou: "快手",
  youtube: "YouTube",
  x: "X (Twitter)",
};

const RECOGNITION_ONLY_PLATFORMS = new Set(["kuaishou", "youtube", "x"]);

function platformName(job: Job): string {
  const id = job.values?.platformId;
  return id ? (PLATFORM_LABELS[id] ?? id) : "分享导入";
}

function isShareImport(job: Job): boolean {
  return job.moduleId === "share-content-import" || job.moduleId === "douyin-video-import";
}

export function VideoExtractPage() {
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
          <a href="/assets/materials" className="job-result-link">
            <FolderOpen size={12} /> 查看素材
          </a>
        );
      }
      return <span className="job-result-none">—</span>;
    }

    const platformId = job.values?.platformId ?? "";

    if (job.status === "succeeded" || job.status === "partially_succeeded") {
      return (
        <a href="/assets/materials" className="job-result-link">
          <FolderOpen size={12} /> 已保存到素材库
        </a>
      );
    }

    if (job.status === "failed") {
      if (platformId && RECOGNITION_ONLY_PLATFORMS.has(platformId)) {
        return <span className="job-result-unsupported">暂不支持下载</span>;
      }
      const msg = job.error?.message ?? "";
      if (msg.includes("不支持") || msg.includes("not supported")) {
        return <span className="job-result-unsupported">暂不支持下载</span>;
      }
      return <span className="job-result-error">{msg || "导入失败"}</span>;
    }

    if (job.status === "cancelled") {
      return <span className="job-result-none">已取消</span>;
    }

    return <span className="job-result-none">—</span>;
  }

  const showCandidateStep = candidates.length > 0 && !submitting;

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <main className="utility-task-page">

      {/* ── Unified job list ──────────────────────────────────────────── */}
      <section className="utility-job-list" aria-label="任务列表">
        <div className="utility-job-row utility-job-head">
          <span>任务</span>
          <span>状态</span>
          <span>进度</span>
          <span>结果</span>
          <span>创建时间</span>
        </div>
        {allJobs.map((job) => (
          <div className="utility-job-row" key={job.id}>
            <span className="utility-job-title">
              {isShareImport(job) ? (
                <span className="job-platform-badge">{platformName(job)}</span>
              ) : (
                <Download size={16} />
              )}
              <span className="job-title-text">{job.title}</span>
            </span>
            <span className="utility-job-status">
              <span>{job.stage}</span>
              {job.error?.message && !isShareImport(job) && (
                <small title={job.error.message}>{job.error.message}</small>
              )}
            </span>
            <span>{job.progress}%</span>
            <span className="utility-job-result">{renderJobResult(job)}</span>
            <time>{new Date(job.createdAt).toLocaleString()}</time>
          </div>
        ))}
        {!allJobs.length && <div className="utility-empty">还没有任务</div>}
      </section>

      {/* ── Unified "new task" dialog ─────────────────────────────────── */}
      {dialogOpen && (
        <div className="utility-dialog-backdrop" role="presentation" onMouseDown={closeDialog}>
          <div
            className="utility-dialog"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2>新建任务</h2>
                <p>粘贴分享文案、短链接或直接视频 URL，自动识别并提取</p>
              </div>
              <button type="button" onClick={closeDialog} aria-label="关闭">
                <X />
              </button>
            </header>

            {/* ── Input step ──────────────────────────────────────────── */}
            {!showCandidateStep && (
              <>
                <label>
                  分享内容或视频链接 <em>*</em>
                  <textarea
                    value={inputText}
                    maxLength={4096}
                    rows={4}
                    onChange={(event) => setInputText(event.target.value)}
                    placeholder="粘贴抖音/快手/YouTube/X 分享链接、复制文案，或直接视频 URL…"
                    className="unified-task-input"
                  />
                  <small>支持整段复制文案，自动识别平台和提取链接</small>
                </label>
                <label>
                  目标存储文件夹
                  <select required value={folderId} onChange={(event) => setFolderId(event.target.value)}>
                    {folders.data?.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </label>
                {error && <p className="utility-error">{error}</p>}
                <footer>
                  <button type="button" onClick={closeDialog}>
                    取消
                  </button>
                  <button
                    className="primary-action"
                    disabled={inputText.trim().length === 0 || parsing || submitting}
                    onClick={handleSubmit}
                  >
                    {parsing ? (
                      <>
                        <Loader2 className="spin" size={14} /> 解析中…
                      </>
                    ) : submitting ? (
                      <>
                        <Loader2 className="spin" size={14} /> 提交中…
                      </>
                    ) : (
                      "开始提取"
                    )}
                  </button>
                </footer>
              </>
            )}

            {/* ── Candidate selection step ────────────────────────────── */}
            {showCandidateStep && (
              <>
                <label>
                  检测到多个分享链接，请选择要导入的内容
                  <div className="share-candidates-list">
                    {candidates.map((candidate, index) => (
                      <button
                        key={`${candidate.platformId}-${index}`}
                        className={`share-candidate-item ${selectedCandidate?.raw === candidate.raw ? "selected" : ""}`}
                        onClick={() => setSelectedCandidate(candidate)}
                      >
                        <span className="share-platform-badge">
                          {PLATFORM_LABELS[candidate.platformId] ?? candidate.platformId}
                        </span>
                        <span className="share-candidate-label">{candidate.label}</span>
                        <span className="share-confidence">
                          {candidate.confidence === "high"
                            ? "高置信"
                            : candidate.confidence === "medium"
                              ? "中置信"
                              : "低置信"}
                        </span>
                      </button>
                    ))}
                  </div>
                </label>
                <label>
                  保存到文件夹 <em>*</em>
                  <select value={folderId} onChange={(event) => setFolderId(event.target.value)}>
                    {folders.data?.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </label>
                {error && <p className="utility-error">{error}</p>}
                <footer>
                  <button
                    type="button"
                    onClick={() => {
                      setCandidates([]);
                      setSelectedCandidate(null);
                      setError("");
                    }}
                  >
                    重新输入
                  </button>
                  <button
                    className="primary-action"
                    disabled={!selectedCandidate || submitting}
                    onClick={handleCandidateConfirm}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="spin" size={14} /> 提交中…
                      </>
                    ) : (
                      "开始导入"
                    )}
                  </button>
                </footer>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
