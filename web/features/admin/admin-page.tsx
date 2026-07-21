// biome-ignore-all lint/a11y/useButtonType: Admin controls do not use native form submission.
// biome-ignore-all lint/a11y/noStaticElementInteractions: The modal backdrop dismisses its dialog.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, KeyRound, LoaderCircle, RefreshCw, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  type AdminCredential,
  type AdminJob,
  fetchAdminCredentials,
  fetchAdminJobs,
  removeAdminCredential,
  saveAdminCredential,
  uploadAdminEnvKey,
} from "@/api/api-client";
import type { ModuleId, ProviderCredentialName } from "@/api/generated/types.gen";
import { isAdminEmail } from "@/app/config";
import { DataTable } from "@/components/ui/data-table";
import { apiErrorMessage, useAuth } from "@/features/account/auth-context";
import "./admin-page.css";

const statusLabels: Record<AdminJob["status"], string> = {
  queued: "排队中",
  processing: "执行中",
  succeeded: "成功",
  partially_succeeded: "部分成功",
  failed: "失败",
  cancelled: "已取消",
};

function CredentialsPanel({ importNotice, importFailed }: { importNotice?: string; importFailed?: boolean }) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Partial<Record<ProviderCredentialName, string>>>({});
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const { data = [], isLoading, error } = useQuery({ queryKey: ["admin-credentials"], queryFn: fetchAdminCredentials });
  const groups = useMemo(
    () =>
      Object.entries(
        data.reduce<Record<string, AdminCredential[]>>((result, item) => {
          const group = result[item.provider] ?? [];
          group.push(item);
          result[item.provider] = group;
          return result;
        }, {}),
      ),
    [data],
  );
  const run = async (name: ProviderCredentialName, task: () => Promise<void>) => {
    setBusy(name);
    setNotice("");
    try {
      await task();
      await queryClient.invalidateQueries({ queryKey: ["admin-credentials"] });
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setBusy("");
    }
  };
  if (isLoading)
    return (
      <div className="admin-state">
        <LoaderCircle className="spin" /> 正在读取加密凭证…
      </div>
    );
  if (error) return <div className="admin-state error">{apiErrorMessage(error, "凭证读取失败")}</div>;
  return (
    <div className="admin-credentials">
      <div className="admin-security-note">
        <ShieldCheck />
        <b>AES-256-GCM 加密存储</b>
        <span>不回填明文；留空不修改，上传仅覆盖 `.env.key` 中的非空白名单字段。</span>
      </div>
      {importNotice && <p className={`admin-notice${importFailed ? "" : " success"}`}>{importNotice}</p>}
      {notice && <p className="admin-notice">{notice}</p>}
      {groups.map(([provider, credentials]) => (
        <section className="admin-credential-group" key={provider}>
          <header>
            <div>
              <KeyRound />
              <h2>{provider}</h2>
            </div>
            <small>
              {credentials.filter((item) => item.configured).length}/{credentials.length} 已配置
            </small>
          </header>
          {credentials.map((credential) => (
            <div className="admin-credential-row" key={credential.name}>
              <div className="admin-credential-meta">
                <b>{credential.label}</b>
                <code>{credential.name}</code>
                <span className={credential.configured ? "configured" : "missing"}>
                  {credential.configured ? (
                    <>
                      <CheckCircle2 /> 已配置 {credential.maskedValue}
                    </>
                  ) : (
                    "未配置"
                  )}
                </span>
                {credential.updatedAt && (
                  <time>{new Date(credential.updatedAt).toLocaleString("zh-CN", { hour12: false })}</time>
                )}
              </div>
              <input
                type="password"
                autoComplete="new-password"
                value={drafts[credential.name] ?? ""}
                placeholder={credential.configured ? "输入新值以覆盖" : "输入 Key"}
                onChange={(event) => setDrafts((current) => ({ ...current, [credential.name]: event.target.value }))}
              />
              <button
                className="primary"
                disabled={!drafts[credential.name]?.trim() || Boolean(busy)}
                onClick={() =>
                  run(credential.name, async () => {
                    await saveAdminCredential(credential.name, drafts[credential.name] ?? "");
                    setDrafts((current) => ({ ...current, [credential.name]: "" }));
                  })
                }
              >
                {busy === credential.name ? <LoaderCircle className="spin" /> : "保存"}
              </button>
              <button
                className="danger"
                aria-label={`删除 ${credential.label}`}
                disabled={!credential.configured || Boolean(busy)}
                onClick={() => {
                  if (window.confirm(`确定删除 ${credential.name}？依赖它的新任务会失败。`))
                    void run(credential.name, async () => {
                      await removeAdminCredential(credential.name);
                    });
                }}
              >
                <Trash2 />
              </button>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function JobsPanel() {
  const [page, setPage] = useState(1);
  const [moduleId, setModuleId] = useState("");
  const [status, setStatus] = useState("");
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState<AdminJob>();
  const query = useQuery({
    queryKey: ["admin-jobs", page, moduleId, status, email],
    queryFn: () =>
      fetchAdminJobs({
        page,
        pageSize: 25,
        moduleId: moduleId ? (moduleId as ModuleId) : undefined,
        status: status ? (status as AdminJob["status"]) : undefined,
        email: email.trim() || undefined,
      }),
    refetchInterval: 5_000,
  });
  const columns = useMemo<ColumnDef<AdminJob, unknown>[]>(
    () => [
      {
        id: "id",
        header: "任务 ID",
        size: 180,
        cell: ({ row }) => (
          <button className="admin-job-link" onClick={() => setSelected(row.original)}>
            {row.original.id.slice(0, 8)}…
          </button>
        ),
      },
      { accessorKey: "ownerEmail", header: "用户", size: 210 },
      { accessorKey: "moduleId", header: "模块", size: 150 },
      { accessorKey: "title", header: "标题", size: 220 },
      {
        id: "status",
        header: "状态",
        size: 120,
        cell: ({ row }) => (
          <span className={`admin-job-status ${row.original.status}`}>{statusLabels[row.original.status]}</span>
        ),
      },
      { id: "progress", header: "进度", size: 100, cell: ({ row }) => `${row.original.progress}%` },
      { accessorKey: "stage", header: "阶段", size: 180 },
      { accessorKey: "overallExecutionMode", header: "模式", size: 100 },
      {
        id: "provider",
        header: "Provider",
        size: 150,
        cell: ({ row }) => row.original.provenance.find((item) => item.provider)?.provider ?? "—",
      },
      {
        id: "createdAt",
        header: "创建时间",
        size: 190,
        cell: ({ row }) => new Date(row.original.createdAt).toLocaleString("zh-CN", { hour12: false }),
      },
      {
        id: "updatedAt",
        header: "更新时间",
        size: 190,
        cell: ({ row }) => new Date(row.original.updatedAt).toLocaleString("zh-CN", { hour12: false }),
      },
    ],
    [],
  );
  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / 25));
  return (
    <div className="admin-jobs">
      <div className="admin-job-filters">
        <input
          placeholder="搜索用户邮箱"
          value={email}
          onChange={(event) => {
            setPage(1);
            setEmail(event.target.value);
          }}
        />
        <select
          value={moduleId}
          onChange={(event) => {
            setPage(1);
            setModuleId(event.target.value);
          }}
        >
          <option value="">全部模块</option>
          <option value="video-remix">视频复刻</option>
          <option value="video-create">一键成片</option>
          <option value="ad-script">广告脚本</option>
          <option value="video-cut">视频切片</option>
          <option value="voice-clone">声音克隆</option>
          <option value="subtitle-erase">字幕擦除</option>
          <option value="video-enhancement">视频增强</option>
        </select>
        <select
          value={status}
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
        >
          <option value="">全部状态</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
        <button onClick={() => void query.refetch()}>
          <RefreshCw className={query.isFetching ? "spin" : ""} /> 刷新
        </button>
        <span>共 {query.data?.total ?? 0} 个任务</span>
      </div>
      <DataTable
        className="admin-job-table"
        columns={columns}
        data={query.data?.jobs ?? []}
        getRowId={(job) => job.id}
        loading={query.isLoading}
        error={query.error}
        emptyMessage="暂无符合条件的任务"
        minWidth={1770}
        height="calc(100% - 92px)"
      />
      <footer className="admin-pagination">
        <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
          上一页
        </button>
        <span>
          第 {page} / {totalPages} 页
        </span>
        <button disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>
          下一页
        </button>
      </footer>
      {selected && (
        <div className="admin-detail-layer" role="presentation" onMouseDown={() => setSelected(undefined)}>
          <aside role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <small>QUEUE JOB</small>
                <h2>任务详情</h2>
              </div>
              <button aria-label="关闭" onClick={() => setSelected(undefined)}>
                <X />
              </button>
            </header>
            <dl>
              <dt>任务 ID</dt>
              <dd>{selected.id}</dd>
              <dt>用户</dt>
              <dd>{selected.ownerEmail}</dd>
              <dt>阶段</dt>
              <dd>{selected.stage}</dd>
              <dt>Provider 状态</dt>
              <dd>{selected.providerStatus ?? "—"}</dd>
              <dt>Provider Task ID</dt>
              <dd>{selected.providerTaskId ?? "—"}</dd>
              <dt>错误</dt>
              <dd>
                <pre>{selected.error ? JSON.stringify(selected.error, null, 2) : "—"}</pre>
              </dd>
            </dl>
          </aside>
        </div>
      )}
    </div>
  );
}

export function AdminPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"credentials" | "jobs">("credentials");
  const [uploading, setUploading] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  const [importFailed, setImportFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  if (!user || !isAdminEmail(user.email)) return <Navigate to="/" />;
  const importFile = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    setImportNotice("");
    setImportFailed(false);
    try {
      const result = await uploadAdminEnvKey(file);
      await queryClient.invalidateQueries({ queryKey: ["admin-credentials"] });
      const ignored = result.ignored.length ? `，忽略 ${result.ignored.length} 个非白名单字段` : "";
      setImportNotice(`已更新 ${result.updated.length} 项，跳过 ${result.skipped.length} 项${ignored}`);
    } catch (error) {
      setImportFailed(true);
      setImportNotice(apiErrorMessage(error, ".env.key 导入失败"));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  return (
    <div className="admin-page">
      <section className="admin-container">
        <header className="admin-toolbar">
          <nav>
            <button
              className={`admin-tab${tab === "credentials" ? " active" : ""}`}
              onClick={() => setTab("credentials")}
            >
              密钥管理
            </button>
            <button className={`admin-tab${tab === "jobs" ? " active" : ""}`} onClick={() => setTab("jobs")}>
              队列任务
            </button>
          </nav>
          {tab === "credentials" && (
            <div className="admin-upload">
              <input
                ref={fileInput}
                type="file"
                accept=".env.key"
                aria-label="选择 .env.key 文件"
                onChange={(event) => void importFile(event.target.files?.[0])}
              />
              <button disabled={uploading} onClick={() => fileInput.current?.click()}>
                {uploading ? <LoaderCircle className="spin" /> : <Upload />} 导入 .env.key
              </button>
            </div>
          )}
        </header>
        <main className={`admin-content ${tab}`}>
          {tab === "credentials" ? (
            <CredentialsPanel importNotice={importNotice} importFailed={importFailed} />
          ) : (
            <JobsPanel />
          )}
        </main>
      </section>
    </div>
  );
}
