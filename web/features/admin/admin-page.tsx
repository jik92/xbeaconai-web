import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  Coins,
  LoaderCircle,
  RefreshCw,
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
  type AdminUser,
  fetchAdminCredentials,
  fetchAdminJobs,
  fetchAdminUsers,
  grantCreditsToAdminUser,
  removeAdminCredential,
  runAdminCredentialDoctor,
  saveAdminCredential,
  setAdminUserStatus,
  stopAllAdminQueueJobs,
  uploadAdminEnvKey,
} from "@/api/api-client";
import { ToolCreatorModal } from "@/components/domain/tool-creator-modal";
import type { ModuleId, ProviderCredentialName } from "@/api/generated/types.gen";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { apiErrorMessage, useAuth } from "@/features/account/auth-context";
import { randomUuid } from "@/lib/random-id";

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

const userStatusLabels: Record<AdminUser["status"], string> = {
  pending_password: "待设置密码",
  active: "正常",
  disabled: "已注销",
};

const userStatusStyles: Record<AdminUser["status"], string> = {
  pending_password: "bg-warning/10 text-warning",
  active: "bg-success/10 text-success",
  disabled: "bg-surface-muted text-muted",
};

function DoctorStatus({ result }: { result?: AdminCredentialDoctorResult }) {
  if (!result) return <span className="text-xs text-muted">未检测</span>;
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
  const [saving, setSaving] = useState<ProviderCredentialName>();
  const [deleting, setDeleting] = useState<ProviderCredentialName>();
  const [doctorBusy, setDoctorBusy] = useState(false);
  const [doctorResults, setDoctorResults] = useState<AdminCredentialDoctorResult[]>([]);
  const [uploading, setUploading] = useState(false);
  const { data = [], isLoading, error } = useQuery({ queryKey: ["admin-credentials"], queryFn: fetchAdminCredentials });

  const saveCredential = async (credential: AdminCredential) => {
    const value = drafts[credential.name]?.trim();
    if (!value) return;
    setSaving(credential.name);
    try {
      await saveAdminCredential(credential.name, value);
      setDrafts((current) => {
        const next = { ...current };
        delete next[credential.name];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["admin-credentials"] });
      setDoctorResults([]);
      toast.success(`${credential.label} 已保存`);
    } catch (reason) {
      toast.error(apiErrorMessage(reason, "密钥保存失败"));
    } finally {
      setSaving(undefined);
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

  const columns: ColumnDef<AdminCredential, unknown>[] = [
    {
      accessorKey: "provider",
      header: "Provider",
      size: 100,
      cell: ({ row }) => <span className="font-medium text-ink">{row.original.provider}</span>,
    },
    {
      id: "credential",
      header: "密钥",
      size: 220,
      cell: ({ row }) => (
        <div className="min-w-0">
          <span className="block truncate font-medium text-ink">{row.original.label}</span>
          <code className="block truncate text-2xs text-muted">{row.original.name}</code>
        </div>
      ),
    },
    {
      id: "status",
      header: "当前状态",
      size: 120,
      cell: ({ row }) => (
        <span className={`text-xs ${row.original.configured ? "text-success" : "text-warning"}`}>
          {row.original.configured ? row.original.maskedValue : "未配置"}
        </span>
      ),
    },
    {
      id: "value",
      header: "新值",
      size: 270,
      cell: ({ row }) => (
        <Input
          type={row.original.secret ? "password" : "text"}
          autoComplete="new-password"
          className="h-8 text-xs"
          value={drafts[row.original.name] ?? ""}
          placeholder={row.original.configured ? "输入新值以覆盖" : "输入 Key"}
          onChange={(event) => setDrafts((current) => ({ ...current, [row.original.name]: event.target.value }))}
        />
      ),
    },
    {
      id: "doctor",
      header: "检测结果",
      size: 300,
      cell: ({ row }) => (
        <DoctorStatus result={doctorResults.find((result) => result.provider === row.original.provider)} />
      ),
    },
    {
      id: "actions",
      header: "操作",
      size: 112,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={!drafts[row.original.name]?.trim() || Boolean(saving) || Boolean(deleting)}
            onClick={() => void saveCredential(row.original)}
          >
            {saving === row.original.name && <LoaderCircle className="animate-spin" />} 保存
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-danger hover:bg-danger/10 hover:text-danger"
            aria-label={`删除 ${row.original.label}`}
            disabled={!row.original.configured || Boolean(saving) || Boolean(deleting)}
            onClick={() => void remove(row.original)}
          >
            {deleting === row.original.name ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
          </Button>
        </div>
      ),
    },
  ];

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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-11 shrink-0 items-center justify-end gap-2 border-b border-line px-1">
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
      <DataTable
        columns={columns}
        data={data}
        getRowId={(credential) => credential.name}
        emptyMessage="暂无密钥配置"
        className="min-h-0 flex-1"
      />
    </div>
  );
}

function UsersPanel() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [rechargeUser, setRechargeUser] = useState<AdminUser>();
  const [credits, setCredits] = useState("");
  const [rechargeKey, setRechargeKey] = useState("");
  const [busyUserId, setBusyUserId] = useState("");
  const query = useQuery({
    queryKey: ["admin-users", page, search, status],
    queryFn: () =>
      fetchAdminUsers({
        page,
        pageSize: 25,
        query: search.trim() || undefined,
        status: status ? (status as AdminUser["status"]) : undefined,
      }),
  });
  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / 25));

  const changeStatus = async (member: AdminUser, nextStatus: "active" | "disabled") => {
    const action = nextStatus === "disabled" ? "注销" : "恢复";
    const message =
      nextStatus === "disabled"
        ? `确定注销 ${member.displayName}（${member.phone}）？该用户将立即退出登录。`
        : `确定恢复 ${member.displayName}（${member.phone}）？`;
    if (!window.confirm(message)) return;
    setBusyUserId(member.id);
    try {
      await setAdminUserStatus(member.id, nextStatus);
      await query.refetch();
      toast.success(`用户已${action}`);
    } catch (reason) {
      toast.error(apiErrorMessage(reason, `${action}用户失败`));
    } finally {
      setBusyUserId("");
    }
  };

  const recharge = async () => {
    if (!rechargeUser || !rechargeKey) return;
    const amount = Number(credits);
    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000_000) {
      toast.error("请输入 1 至 1,000,000,000 的整数创作点");
      return;
    }
    setBusyUserId(rechargeUser.id);
    try {
      const result = await grantCreditsToAdminUser(rechargeUser.id, amount, rechargeKey);
      await query.refetch();
      toast.success(`已充值 ${result.grant.credits.toLocaleString()} 创作点`);
      setRechargeUser(undefined);
      setCredits("");
      setRechargeKey("");
    } catch (reason) {
      toast.error(apiErrorMessage(reason, "用户充值失败"));
    } finally {
      setBusyUserId("");
    }
  };

  const columns: ColumnDef<AdminUser, unknown>[] = [
    {
      id: "displayName",
      header: "用户名",
      size: 180,
      cell: ({ row }) => (
        <span className="inline-flex min-w-0 items-center gap-2 font-medium text-ink">
          <span className="truncate">{row.original.displayName}</span>
          {row.original.isAdmin && <span className="text-2xs text-muted">管理员</span>}
        </span>
      ),
    },
    { accessorKey: "phone", header: "手机号", size: 125 },
    {
      id: "credits",
      header: "创作点",
      size: 100,
      cell: ({ row }) => row.original.credits.toLocaleString(),
    },
    {
      id: "status",
      header: "状态",
      size: 90,
      cell: ({ row }) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-2xs ${userStatusStyles[row.original.status]}`}>
          {userStatusLabels[row.original.status]}
        </span>
      ),
    },
    {
      id: "createdAt",
      header: "注册时间",
      size: 150,
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleString("zh-CN", { hour12: false }),
    },
    {
      id: "updatedAt",
      header: "更新时间",
      size: 150,
      cell: ({ row }) => new Date(row.original.updatedAt).toLocaleString("zh-CN", { hour12: false }),
    },
    {
      id: "actions",
      header: "操作",
      size: 190,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          {row.original.status === "active" && (
            <Button
              variant="outline"
              size="sm"
              disabled={Boolean(busyUserId)}
              onClick={() => {
                setRechargeUser(row.original);
                setCredits("");
                setRechargeKey(randomUuid());
              }}
            >
              <Coins /> 充值
            </Button>
          )}
          {row.original.status === "active" && !row.original.isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:bg-danger/10 hover:text-danger"
              disabled={Boolean(busyUserId)}
              onClick={() => void changeStatus(row.original, "disabled")}
            >
              {busyUserId === row.original.id && <LoaderCircle className="animate-spin" />} 注销
            </Button>
          )}
          {row.original.status === "disabled" && (
            <Button
              variant="outline"
              size="sm"
              disabled={Boolean(busyUserId)}
              onClick={() => void changeStatus(row.original, "active")}
            >
              {busyUserId === row.original.id && <LoaderCircle className="animate-spin" />} 恢复
            </Button>
          )}
          {row.original.status === "pending_password" && <span className="text-xs text-muted">—</span>}
        </div>
      ),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-1">
        <Input
          className="h-8 w-56 text-xs"
          placeholder="搜索用户名或手机号"
          value={search}
          onChange={(event) => {
            setPage(1);
            setSearch(event.target.value.slice(0, 80));
          }}
        />
        <NativeSelect
          className="h-8 text-xs"
          value={status}
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
        >
          <option value="">全部状态</option>
          {Object.entries(userStatusLabels).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          <RefreshCw className={query.isFetching ? "animate-spin" : ""} /> 刷新
        </Button>
        <span className="ml-auto text-xs text-muted">共 {query.data?.total ?? 0} 个用户</span>
      </div>
      <DataTable
        columns={columns}
        data={query.data?.users ?? []}
        getRowId={(member) => member.id}
        loading={query.isLoading}
        error={query.error}
        emptyMessage="暂无符合条件的用户"
        className="min-h-0 flex-1"
      />
      <footer className="flex h-11 shrink-0 items-center justify-end gap-2 border-t border-line text-xs text-muted">
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
      <ToolCreatorModal
        open={Boolean(rechargeUser)}
        title="充值创作点"
        onClose={() => {
          if (busyUserId) return;
          setRechargeUser(undefined);
          setCredits("");
          setRechargeKey("");
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void recharge();
          }}
        >
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-[72px_1fr] items-center gap-3 text-sm">
              <Label>用户</Label>
              <span className="truncate text-ink">
                {rechargeUser?.displayName} · {rechargeUser?.phone}
              </span>
            </div>
            <div className="grid grid-cols-[72px_1fr] items-center gap-3">
              <Label htmlFor="admin-recharge-credits">创作点</Label>
              <Input
                id="admin-recharge-credits"
                type="number"
                inputMode="numeric"
                min={1}
                max={1_000_000_000}
                step={1}
                autoFocus
                value={credits}
                onChange={(event) => setCredits(event.target.value.replace(/\D/g, "").slice(0, 10))}
                required
              />
            </div>
          </div>
          <footer className="flex h-13 items-center justify-end gap-2 border-t border-line px-4">
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(busyUserId)}
              onClick={() => {
                setRechargeUser(undefined);
                setCredits("");
                setRechargeKey("");
              }}
            >
              取消
            </Button>
            <Button type="submit" disabled={!credits || !rechargeKey || Boolean(busyUserId)}>
              {busyUserId && <LoaderCircle className="animate-spin" />} 确认充值
            </Button>
          </footer>
        </form>
      </ToolCreatorModal>
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
  const [tab, setTab] = useState<"credentials" | "users" | "jobs">("credentials");
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
            className={tab === "users" ? "bg-surface-muted text-ink" : "text-muted"}
            onClick={() => setTab("users")}
          >
            用户管理
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
      {tab === "credentials" ? <CredentialsPanel /> : tab === "users" ? <UsersPanel /> : <JobsPanel />}
    </div>
  );
}
