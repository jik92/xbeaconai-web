import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import {
  type AdminProviderAudit,
  type AdminProviderAuditDetail,
  fetchAdminProviderAudit,
  fetchAdminProviderAudits,
} from "@/api/api-client";
import { MediaPreview } from "@/components/domain/media-preview";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

type AuditQuery = Parameters<typeof fetchAdminProviderAudits>[0];

export interface ProviderAuditPanelProps {
  loadAudits?: (query: AuditQuery) => ReturnType<typeof fetchAdminProviderAudits>;
  loadAudit?: (auditId: string) => Promise<AdminProviderAuditDetail>;
}

const statusLabels: Record<AdminProviderAudit["status"], string> = {
  submitting: "提交中",
  processing: "处理中",
  succeeded: "成功",
  failed: "失败",
  cancelled: "已取消",
};

const statusStyles: Record<AdminProviderAudit["status"], string> = {
  submitting: "bg-surface-muted text-muted",
  processing: "bg-surface-strong text-ink",
  succeeded: "bg-success/10 text-success",
  failed: "bg-error/10 text-error",
  cancelled: "bg-surface-muted text-muted",
};

function formatTime(value?: string) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}

function formatDuration(value?: number) {
  if (value === undefined) return "—";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
}

function dateBoundary(value: string, end = false) {
  if (!value) return undefined;
  return new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}`).toISOString();
}

export interface ProviderAuditFilterState {
  page: number;
  search: string;
  provider: string;
  moduleId: string;
  status: string;
  startedFrom: string;
  startedTo: string;
}

export function buildProviderAuditQuery(filters: ProviderAuditFilterState): AuditQuery {
  return {
    page: filters.page,
    pageSize: 25,
    query: filters.search.trim() || undefined,
    provider: filters.provider || undefined,
    moduleId: filters.moduleId || undefined,
    status: filters.status ? (filters.status as AdminProviderAudit["status"]) : undefined,
    startedFrom: dateBoundary(filters.startedFrom),
    startedTo: dateBoundary(filters.startedTo, true),
  };
}

function JsonBlock({ value, empty = "—" }: { value: unknown; empty?: string }) {
  return (
    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-muted p-3 font-sans type-helper leading-relaxed text-ink">
      {value === undefined ? empty : JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function AuditDetail({ detail, loading }: { detail?: AdminProviderAuditDetail; loading: boolean }) {
  if (loading)
    return <div className="flex min-h-48 items-center justify-center type-helper text-muted">正在加载审计详情…</div>;
  if (!detail)
    return <div className="flex min-h-48 items-center justify-center type-helper text-error">审计详情加载失败</div>;
  return (
    <div className="min-h-0 space-y-4 overflow-y-auto pr-1 type-helper">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-line pb-4 max-md:grid-cols-1">
        {[
          ["用户", `${detail.userDisplayName ?? "—"} · ${detail.userPhone ?? "—"}`],
          ["用户 ID", detail.ownerUserId],
          ["本地任务", detail.jobId],
          ["模块 / 能力", `${detail.moduleId} / ${detail.capability}`],
          ["Provider / 模型", `${detail.provider}${detail.model ? ` / ${detail.model}` : ""}`],
          ["接口操作", detail.operation],
          ["第三方任务 ID", detail.providerTaskId ?? "—"],
          ["第三方请求 ID", detail.providerRequestId ?? "—"],
          ["提交时间", formatTime(detail.submittedAt)],
          ["完成时间 / 耗时", `${formatTime(detail.completedAt)} / ${formatDuration(detail.durationMs)}`],
        ].map(([label, value]) => (
          <div className="grid min-w-0 grid-cols-[96px_1fr] gap-2" key={label}>
            <dt className="text-muted">{label}</dt>
            <dd className="min-w-0 break-all text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <section className="space-y-2">
        <h3 className="type-section-title text-ink">原始提交参数</h3>
        <JsonBlock value={detail.requestPayload} />
      </section>
      <section className="space-y-2">
        <h3 className="type-section-title text-ink">第三方响应</h3>
        <JsonBlock value={detail.responsePayload} />
      </section>
      {detail.errorPayload !== undefined && (
        <section className="space-y-2">
          <h3 className="type-section-title text-error">错误信息</h3>
          <JsonBlock value={detail.errorPayload} />
        </section>
      )}
      <section className="space-y-2">
        <h3 className="type-section-title text-ink">生成素材</h3>
        {detail.assets.length ? (
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            {detail.assets.map((asset) => (
              <div className="min-w-0 rounded-xl border border-line p-2" key={asset.id}>
                <div className="mb-2 truncate type-helper text-ink">{asset.name}</div>
                {asset.available && asset.url && asset.mimeType ? (
                  <MediaPreview
                    url={asset.url}
                    mimeType={asset.mimeType}
                    alt={asset.name}
                    className="max-h-64 w-full rounded-lg bg-surface-dark object-contain"
                  />
                ) : (
                  <div className="flex h-16 items-center justify-center rounded-lg bg-surface-muted text-muted">
                    预览不可用
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg bg-surface-muted p-3 text-muted">无生成素材</div>
        )}
      </section>
    </div>
  );
}

function auditColumns(onView: (auditId: string) => void): ColumnDef<AdminProviderAudit, unknown>[] {
  return [
    { id: "submittedAt", header: "提交时间", size: 145, cell: ({ row }) => formatTime(row.original.submittedAt) },
    {
      id: "user",
      header: "用户",
      size: 130,
      cell: ({ row }) => (
        <span
          className="block truncate"
          title={`${row.original.userDisplayName ?? ""} ${row.original.userPhone ?? ""}`}
        >
          {row.original.userDisplayName ?? "—"} · {row.original.userPhone ?? "—"}
        </span>
      ),
    },
    { accessorKey: "moduleId", header: "模块", size: 100 },
    {
      id: "provider",
      header: "Provider / 模型",
      size: 145,
      cell: ({ row }) => `${row.original.provider}${row.original.model ? ` / ${row.original.model}` : ""}`,
    },
    {
      accessorKey: "providerTaskId",
      header: "第三方任务",
      size: 130,
      cell: ({ row }) => row.original.providerTaskId ?? "—",
    },
    {
      id: "status",
      header: "状态",
      size: 75,
      cell: ({ row }) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 type-helper ${statusStyles[row.original.status]}`}>
          {statusLabels[row.original.status]}
        </span>
      ),
    },
    { id: "duration", header: "耗时", size: 70, cell: ({ row }) => formatDuration(row.original.durationMs) },
    { id: "results", header: "结果", size: 60, cell: ({ row }) => `${row.original.assetCount} 个` },
    {
      id: "actions",
      header: "操作",
      size: 60,
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onView(row.original.id)}>
          查看
        </Button>
      ),
    },
  ];
}

export function ProviderAuditTable({
  audits,
  loading = false,
  error,
  onView,
}: {
  audits: AdminProviderAudit[];
  loading?: boolean;
  error?: unknown;
  onView: (auditId: string) => void;
}) {
  const columns = useMemo(() => auditColumns(onView), [onView]);
  return (
    <DataTable
      columns={columns}
      data={audits}
      getRowId={(audit) => audit.id}
      loading={loading}
      error={error}
      emptyMessage="暂无符合条件的审计日志"
      height="calc(100% - 88px)"
    />
  );
}

export function ProviderAuditPanel({
  loadAudits = fetchAdminProviderAudits,
  loadAudit = fetchAdminProviderAudit,
}: ProviderAuditPanelProps) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [status, setStatus] = useState("");
  const [startedFrom, setStartedFrom] = useState("");
  const [startedTo, setStartedTo] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const query = useQuery({
    queryKey: ["admin-provider-audits", page, search, provider, moduleId, status, startedFrom, startedTo],
    queryFn: () =>
      loadAudits(
        buildProviderAuditQuery({
          page,
          search,
          provider,
          moduleId,
          status,
          startedFrom,
          startedTo,
        }),
      ),
  });
  const detailQuery = useQuery({
    queryKey: ["admin-provider-audit", selectedId],
    queryFn: () => (selectedId ? loadAudit(selectedId) : Promise.reject(new Error("AUDIT_ID_REQUIRED"))),
    enabled: Boolean(selectedId),
  });
  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / 25));
  const update = (setter: (value: string) => void, value: string) => {
    setPage(1);
    setter(value);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-line px-1 py-1">
        <Input
          className="h-8 w-52 type-helper"
          placeholder="用户、任务或第三方任务"
          value={search}
          onChange={(event) => update(setSearch, event.target.value)}
        />
        <NativeSelect
          aria-label="Provider"
          className="h-8 type-helper"
          value={provider}
          onChange={(event) => update(setProvider, event.target.value)}
        >
          <option value="">全部 Provider</option>
          <option value="aihubmix">AIHubMix</option>
          <option value="volcengine">火山引擎</option>
          <option value="volcengine-ai-mediakit">MediaKit</option>
          <option value="alibaba-cloud">阿里云</option>
        </NativeSelect>
        <NativeSelect
          aria-label="模块"
          className="h-8 type-helper"
          value={moduleId}
          onChange={(event) => update(setModuleId, event.target.value)}
        >
          <option value="">全部模块</option>
          <option value="ai-generate">AI 生成</option>
          <option value="video-create">一键成片</option>
          <option value="video-remix">视频复刻</option>
          <option value="ad-script">广告脚本</option>
          <option value="voice-clone">声音克隆</option>
          <option value="subtitle-erase">字幕擦除</option>
          <option value="video-enhancement">视频增强</option>
        </NativeSelect>
        <NativeSelect
          aria-label="状态"
          className="h-8 type-helper"
          value={status}
          onChange={(event) => update(setStatus, event.target.value)}
        >
          <option value="">全部状态</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
        <Input
          aria-label="开始日期"
          className="h-8 w-32 type-helper"
          type="date"
          value={startedFrom}
          onChange={(event) => update(setStartedFrom, event.target.value)}
        />
        <Input
          aria-label="结束日期"
          className="h-8 w-32 type-helper"
          type="date"
          value={startedTo}
          onChange={(event) => update(setStartedTo, event.target.value)}
        />
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          <RefreshCw className={query.isFetching ? "animate-spin" : ""} /> 刷新
        </Button>
        <span className="ml-auto type-helper text-muted">共 {query.data?.total ?? 0} 条日志</span>
      </div>
      <ProviderAuditTable
        audits={query.data?.audits ?? []}
        loading={query.isLoading}
        error={query.error}
        onView={setSelectedId}
      />
      <footer className="flex h-11 items-center justify-end gap-2 border-t border-line type-helper text-muted">
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
      <Dialog
        open={Boolean(selectedId)}
        onOpenChange={(open) => {
          if (!open) setSelectedId(undefined);
        }}
      >
        <DialogContent className="flex max-h-[88vh] max-w-4xl flex-col">
          <DialogHeader>
            <DialogTitle>审计详情</DialogTitle>
          </DialogHeader>
          <AuditDetail detail={detailQuery.data} loading={detailQuery.isLoading} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
