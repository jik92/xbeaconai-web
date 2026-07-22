import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type AdminCredential,
  type AdminCredentialDoctorResult,
  type AdminJob,
  fetchAdminCredentials,
  fetchAdminJobs,
  removeAdminCredential,
  runAdminCredentialDoctor,
  saveAdminCredential,
  stopAllAdminQueueJobs,
  uploadAdminEnvKey,
} from "@/api/api-client";
import type { ModuleId, ProviderCredentialName } from "@/api/generated/types.gen";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { apiErrorMessage, useAuth } from "@/features/account/auth-context";

const statusLabels: Record<AdminJob["status"], string> = {
  queued: "排队中",
  processing: "执行中",
  succeeded: "成功",
  partially_succeeded: "部分成功",
  failed: "失败",
  cancelled: "已取消",
};

const jobStatusStyles: Record<AdminJob["status"], string> = {
  queued: "bg-surface-muted text-muted",
  processing: "bg-surface-strong text-ink",
  succeeded: "bg-success/10 text-success",
  partially_succeeded: "bg-warning/10 text-warning",
  failed: "bg-danger/10 text-danger",
  cancelled: "bg-surface-muted text-muted",
};

const doctorLabels: Record<AdminCredentialDoctorResult["status"], string> = {
  available: "可用",
  missing: "缺少配置",
  invalid: "不可用",
  timeout: "超时",
};

const doctorStyles: Record<AdminCredentialDoctorResult["status"], string> = {
  available: "text-success",
  missing: "text-warning",
  invalid: "text-danger",
  timeout: "text-warning",
};

function DoctorStatus({ result }: { result?: AdminCredentialDoctorResult }) {
  if (!result) return null;
  const Icon = result.status === "available" ? CheckCircle2 : result.status === "timeout" ? Clock3 : CircleAlert;
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 text-xs ${doctorStyles[result.status]}`}>
      <Icon className="size-3.5 shrink-0" />
      <b className="font-medium">{doctorLabels[result.status]}</b>
      <span className="truncate text-muted">{result.message}</span>
      <span className="shrink-0 text-muted">{result.latencyMs}ms</span>
    </span>
  );
}

function CredentialsPanel() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<Partial<Record<ProviderCredentialName, string>>>({});
  const [busyProvider, setBusyProvider] = useState("");
  const [deleting, setDeleting] = useState<ProviderCredentialName>();
  const [doctorBusy, setDoctorBusy] = useState(false);
  const [doctorResults, setDoctorResults] = useState<AdminCredentialDoctorResult[]>([]);
  const [uploading, setUploading] = useState(false);
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

  const saveGroup = async (provider: string, credentials: AdminCredential[]) => {
    const changed = credentials.filter((credential) => drafts[credential.name]?.trim());
    if (!changed.length) return;
    setBusyProvider(provider);
    try {
      await Promise.all(
        changed.map((credential) => saveAdminCredential(credential.name, drafts[credential.name]?.trim() ?? "")),
      );
      setDrafts((current) => {
        const next = { ...current };
        for (const credential of changed) delete next[credential.name];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["admin-credentials"] });
      setDoctorResults([]);
      toast.success(`${provider} 密钥已保存`);
    } catch (reason) {
      toast.error(apiErrorMessage(reason, "密钥保存失败"));
    } finally {
      setBusyProvider("");
    }
  };

  const remove = async (credential: AdminCredential) => {
    if (!window.confirm(`确定删除 ${credential.name}？`)) return;
    setDeleting(credential.name);
    try {
      await removeAdminCredential(credential.name);
      await queryClient.invalidateQueries({ queryKey: ["admin-credentials"] });
      setDoctorResults([]);
      toast.success(`${credential.label} 已删除`);
    } catch (reason) {
      toast.error(apiErrorMessage(reason, "密钥删除失败"));
    } finally {
      setDeleting(undefined);
    }
  };

  const doctor = async () => {
    setDoctorBusy(true);
    try {
      const results = await runAdminCredentialDoctor();
      setDoctorResults(results);
      const available = results.filter((result) => result.status === "available").length;
      toast.success(`检测完成：${available}/${results.length} 个 Provider 可用`);
    } catch (reason) {
      toast.error(apiErrorMessage(reason, "密钥检测失败"));
    } finally {
      setDoctorBusy(false);
    }
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadAdminEnvKey(file);
      await queryClient.invalidateQueries({ queryKey: ["admin-credentials"] });
      setDoctorResults([]);
      toast.success(`已更新 ${result.updated.length} 项，跳过 ${result.skipped.length} 项`);
    } catch (reason) {
      toast.error(apiErrorMessage(reason, ".env.key 导入失败"));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  if (isLoading)
    return (
      <div className="grid min-h-48 place-items-center text-xs text-muted">
        <span className="inline-flex items-center gap-2">
          <LoaderCircle className="size-4 animate-spin" /> 正在读取密钥
        </span>
      </div>
    );
  if (error)
    return <div className="grid min-h-48 place-items-center text-xs text-danger">{apiErrorMessage(error)}</div>;

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex h-11 items-center justify-between gap-3 border-b border-line px-1">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <ShieldCheck className="size-4 text-ink" /> AES-256-GCM 加密存储
        </span>
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".env.key"
            className="hidden"
            aria-label="选择 .env.key 文件"
            onChange={(event) => void importFile(event.target.files?.[0])}
          />
          <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? <LoaderCircle className="animate-spin" /> : <Upload />} 导入 .env.key
          </Button>
          <Button size="sm" disabled={doctorBusy} onClick={() => void doctor()}>
            {doctorBusy ? <LoaderCircle className="animate-spin" /> : <Stethoscope />} 检测全部
          </Button>
        </div>
      </div>
      {groups.map(([provider, credentials]) => {
        const result = doctorResults.find((item) => item.provider === provider);
        const hasDraft = credentials.some((credential) => drafts[credential.name]?.trim());
        return (
          <section className="border-b border-line py-2 last:border-0" key={provider}>
            <header className="flex min-h-8 items-center justify-between gap-3 px-2">
              <div className="flex min-w-0 items-center gap-3">
                <h2 className="shrink-0 text-sm font-medium text-ink">{provider}</h2>
                <DoctorStatus result={result} />
              </div>
              <Button
                size="sm"
                disabled={!hasDraft || Boolean(busyProvider) || Boolean(deleting)}
                onClick={() => void saveGroup(provider, credentials)}
              >
                {busyProvider === provider && <LoaderCircle className="animate-spin" />} 保存
              </Button>
            </header>
            <div className="mt-1 divide-y divide-line/60">
              {credentials.map((credential) => (
                <div
                  className="grid min-h-11 grid-cols-[minmax(180px,1fr)_minmax(240px,1.4fr)_32px] items-center gap-2 px-2"
                  key={credential.name}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-xs font-medium text-ink">{credential.label}</span>
                    <code className="truncate text-2xs text-muted">{credential.name}</code>
                    <span className={`shrink-0 text-2xs ${credential.configured ? "text-success" : "text-warning"}`}>
                      {credential.configured ? credential.maskedValue : "未配置"}
                    </span>
                  </div>
                  <Input
                    type={credential.secret ? "password" : "text"}
                    autoComplete="new-password"
                    className="h-8 text-xs"
                    value={drafts[credential.name] ?? ""}
                    placeholder={credential.configured ? "输入新值以覆盖" : "输入 Key"}
                    onChange={(event) =>
                      setDrafts((current) => ({ ...current, [credential.name]: event.target.value }))
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-danger hover:bg-danger/10 hover:text-danger"
                    aria-label={`删除 ${credential.label}`}
                    disabled={!credential.configured || Boolean(busyProvider) || Boolean(deleting)}
                    onClick={() => void remove(credential)}
                  >
                    {deleting === credential.name ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
                  </Button>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function JobsPanel() {
  const [page, setPage] = useState(1);
  const [moduleId, setModuleId] = useState("");
  const [status, setStatus] = useState("");
  const [phone, setPhone] = useState("");
  const [selected, setSelected] = useState<AdminJob>();
  const [stopping, setStopping] = useState(false);
  const query = useQuery({
    queryKey: ["admin-jobs", page, moduleId, status, phone],
    queryFn: () =>
      fetchAdminJobs({
        page,
        pageSize: 25,
        moduleId: moduleId ? (moduleId as ModuleId) : undefined,
        status: status ? (status as AdminJob["status"]) : undefined,
        phone: phone.trim() || undefined,
      }),
    refetchInterval: 5_000,
  });
  const columns = useMemo<ColumnDef<AdminJob, unknown>[]>(
    () => [
      {
        id: "id",
        header: "任务 ID",
        size: 110,
        cell: ({ row }) => (
          <Button variant="ghost" size="sm" className="h-7 px-1 font-mono" onClick={() => setSelected(row.original)}>
            {row.original.id.slice(0, 8)}…
          </Button>
        ),
      },
      { accessorKey: "ownerPhone", header: "用户", size: 120 },
      { accessorKey: "moduleId", header: "模块", size: 120 },
      { accessorKey: "title", header: "标题", size: 180 },
      {
        id: "status",
        header: "状态",
        size: 90,
        cell: ({ row }) => (
          <span className={`inline-flex rounded-full px-2 py-0.5 text-2xs ${jobStatusStyles[row.original.status]}`}>
            {statusLabels[row.original.status]}
          </span>
        ),
      },
      { id: "progress", header: "进度", size: 70, cell: ({ row }) => `${row.original.progress}%` },
      { accessorKey: "stage", header: "阶段", size: 150 },
      { accessorKey: "overallExecutionMode", header: "模式", size: 70 },
      {
        id: "provider",
        header: "Provider",
        size: 120,
        cell: ({ row }) => row.original.provenance.find((item) => item.provider)?.provider ?? "—",
      },
      {
        id: "createdAt",
        header: "创建时间",
        size: 150,
        cell: ({ row }) => new Date(row.original.createdAt).toLocaleString("zh-CN", { hour12: false }),
      },
      {
        id: "updatedAt",
        header: "更新时间",
        size: 150,
        cell: ({ row }) => new Date(row.original.updatedAt).toLocaleString("zh-CN", { hour12: false }),
      },
    ],
    [],
  );
  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / 25));

  const stopAll = async () => {
    if (!window.confirm("确定停止当前所有排队中和执行中的任务？")) return;
    setStopping(true);
    try {
      const result = await stopAllAdminQueueJobs();
      await query.refetch();
      toast.success(`已取消 ${result.queuedCancelled} 个排队任务，已请求停止 ${result.processingRequested} 个执行任务`);
      if (result.failed) toast.warning(`${result.failed} 个 BullMQ 清理操作失败，数据库任务已停止`);
    } catch (reason) {
      toast.error(apiErrorMessage(reason, "停止所有任务失败"));
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 items-center gap-2 border-b border-line px-1">
        <Input
          className="h-8 w-52 text-xs"
          placeholder="搜索用户手机号"
          value={phone}
          onChange={(event) => {
            setPage(1);
            setPhone(event.target.value.replace(/\D/g, "").slice(0, 11));
          }}
        />
        <NativeSelect
          className="h-8 text-xs"
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
        </NativeSelect>
        <NativeSelect
          className="h-8 text-xs"
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
        </NativeSelect>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          <RefreshCw className={query.isFetching ? "animate-spin" : ""} /> 刷新
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-danger hover:bg-danger/10 hover:text-danger"
          disabled={stopping}
          onClick={() => void stopAll()}
        >
          {stopping && <LoaderCircle className="animate-spin" />} 停止所有任务
        </Button>
        <span className="ml-auto text-xs text-muted">共 {query.data?.total ?? 0} 个任务</span>
      </div>
      <DataTable
        columns={columns}
        data={query.data?.jobs ?? []}
        getRowId={(job) => job.id}
        loading={query.isLoading}
        error={query.error}
        emptyMessage="暂无符合条件的任务"
        height="calc(100% - 88px)"
      />
      <footer className="flex h-11 items-center justify-end gap-2 border-t border-line text-xs text-muted">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
          上一页
        </Button>
        <span>
          第 {page} / {totalPages} 页
        </span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>
          下一页
        </Button>
      </footer>
      {selected && (
        <div
          className="fixed inset-0 z-80 flex justify-end bg-black/35"
          role="presentation"
          onMouseDown={() => setSelected(undefined)}
        >
          <aside
            className="h-full w-[min(480px,92vw)] overflow-auto bg-white p-4 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label="任务详情"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex h-10 items-center justify-between border-b border-line">
              <h2 className="text-base font-medium text-ink">任务详情</h2>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="关闭"
                onClick={() => setSelected(undefined)}
              >
                <X />
              </Button>
            </header>
            <dl className="divide-y divide-line text-xs">
              {[
                ["任务 ID", selected.id],
                ["用户", selected.ownerPhone],
                ["阶段", selected.stage],
                ["Provider 状态", selected.providerStatus ?? "—"],
                ["Provider Task ID", selected.providerTaskId ?? "—"],
              ].map(([label, value]) => (
                <div className="grid grid-cols-[120px_1fr] gap-3 py-3" key={label}>
                  <dt className="text-muted">{label}</dt>
                  <dd className="min-w-0 break-all text-ink">{value}</dd>
                </div>
              ))}
              <div className="grid grid-cols-[120px_1fr] gap-3 py-3">
                <dt className="text-muted">错误</dt>
                <dd>
                  <pre className="whitespace-pre-wrap break-all text-2xs text-ink">
                    {selected.error ? JSON.stringify(selected.error, null, 2) : "—"}
                  </pre>
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      )}
    </div>
  );
}

export function AdminPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"credentials" | "jobs">("credentials");
  if (!user?.isAdmin) return <Navigate to="/" />;
  return (
    <div className="flex h-[calc(100vh-56px)] min-h-0 flex-col bg-white p-3 text-ink">
      <header className="flex h-10 shrink-0 items-center border-b border-line">
        <nav className="flex items-center gap-1" aria-label="管理后台">
          <Button
            variant="ghost"
            size="sm"
            className={tab === "credentials" ? "bg-surface-muted text-ink" : "text-muted"}
            onClick={() => setTab("credentials")}
          >
            密钥管理
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={tab === "jobs" ? "bg-surface-muted text-ink" : "text-muted"}
            onClick={() => setTab("jobs")}
          >
            队列任务
          </Button>
        </nav>
      </header>
      {tab === "credentials" ? <CredentialsPanel /> : <JobsPanel />}
    </div>
  );
}
