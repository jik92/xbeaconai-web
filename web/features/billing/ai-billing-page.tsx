import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { listAiConsumptionRecords, listAiRechargeRecords } from "@/api/generated/sdk.gen";
import type { AiConsumptionRecord, AiRechargeRecord } from "@/api/generated/types.gen";
import { modules } from "@/app/routes";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Switch } from "@/components/ui/switch";

const PAGE_SIZE = 25;
const moduleLabels: Record<string, string> = {
  ...Object.fromEntries(modules.map((module) => [module.id, module.label])),
  "douyin-video-import": "抖音下载",
  "share-content-import": "视频提取",
  "portrait-asset-register": "自建虚拟人像",
};

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString("zh-CN", { hour12: false, year: "numeric", month: "2-digit", day: "2-digit" });
const formatCredits = (value: number) => value.toLocaleString("zh-CN");

const rechargeColumns: ColumnDef<AiRechargeRecord>[] = [
  {
    accessorKey: "createdAt",
    header: "时间",
    size: 170,
    cell: ({ row }) => formatDateTime(row.original.createdAt),
  },
  {
    accessorKey: "source",
    header: "来源",
    size: 130,
    cell: ({ row }) => (row.original.source === "mock_recharge" ? "创作点充值" : "管理员充值"),
  },
  { accessorKey: "id", header: "流水号", size: 220 },
  {
    accessorKey: "credits",
    header: "创作点",
    size: 110,
    cell: ({ row }) => <span className="text-success">+{formatCredits(row.original.credits)}</span>,
  },
  {
    accessorKey: "amountCny",
    header: "金额",
    size: 100,
    cell: ({ row }) => (row.original.amountCny === undefined ? "—" : `¥${row.original.amountCny.toFixed(2)}`),
  },
  {
    accessorKey: "balanceAfter",
    header: "变更后余额",
    size: 120,
    cell: ({ row }) => formatCredits(row.original.balanceAfter),
  },
  {
    accessorKey: "status",
    header: "状态",
    size: 90,
    cell: () => <span className="text-success">已到账</span>,
  },
];

const consumptionColumns: ColumnDef<AiConsumptionRecord>[] = [
  {
    accessorKey: "createdAt",
    header: "时间",
    size: 170,
    cell: ({ row }) => formatDateTime(row.original.createdAt),
  },
  {
    accessorKey: "moduleId",
    header: "AI功能",
    size: 130,
    cell: ({ row }) =>
      row.original.moduleId ? (moduleLabels[row.original.moduleId] ?? row.original.moduleId) : "未知功能",
  },
  {
    accessorKey: "jobTitle",
    header: "任务",
    size: 220,
    cell: ({ row }) => (
      <span title={`${row.original.jobTitle ?? "历史任务"} · ${row.original.jobId}`}>
        {row.original.jobTitle ?? row.original.jobId}
      </span>
    ),
  },
  {
    accessorKey: "type",
    header: "类型",
    size: 90,
    cell: ({ row }) => (row.original.type === "charge" ? "消费" : <span className="text-success">已退回</span>),
  },
  {
    accessorKey: "creditChange",
    header: "创作点变化",
    size: 120,
    cell: ({ row }) => (
      <span className={row.original.creditChange > 0 ? "text-success" : "text-ink"}>
        {row.original.creditChange > 0 ? "+" : ""}
        {formatCredits(row.original.creditChange)}
      </span>
    ),
  },
  {
    accessorKey: "balanceAfter",
    header: "变更后余额",
    size: 120,
    cell: ({ row }) => formatCredits(row.original.balanceAfter),
  },
  {
    accessorKey: "note",
    header: "备注",
    size: 180,
    cell: ({ row }) => row.original.note ?? "—",
  },
];

export function AiBillingPage() {
  const [type, setType] = useState<"recharges" | "consumption">("recharges");
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["ai-billing", type, page],
    queryFn: async () => {
      const request = type === "recharges" ? listAiRechargeRecords : listAiConsumptionRecords;
      const { data } = await request({ query: { page, pageSize: PAGE_SIZE }, throwOnError: true });
      if (!data) throw new Error("账单加载失败");
      return data;
    },
  });
  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / PAGE_SIZE));
  const recordTitle = type === "recharges" ? "充值记录" : "消费记录";
  const columns = useMemo(() => (type === "recharges" ? rechargeColumns : consumptionColumns), [type]) as ColumnDef<
    AiRechargeRecord | AiConsumptionRecord
  >[];
  const records = (query.data?.records ?? []) as Array<AiRechargeRecord | AiConsumptionRecord>;

  return (
    <div className="flex h-[calc(100vh-56px)] min-h-0 flex-col bg-white p-3 text-ink">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-1">
        <h1 className="text-xl font-medium">AI账单</h1>
        <div className="ml-auto flex items-center gap-2 text-xs" role="group" aria-label="账单记录类型">
          <span className={type === "recharges" ? "font-medium text-ink" : "text-muted"}>充值记录</span>
          <Switch
            checked={type === "consumption"}
            aria-label="切换充值记录和消费记录"
            onCheckedChange={(checked) => {
              setType(checked ? "consumption" : "recharges");
              setPage(1);
            }}
          />
          <span className={type === "consumption" ? "font-medium text-ink" : "text-muted"}>消费记录</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          <RefreshCw className={query.isFetching ? "animate-spin" : ""} /> 刷新
        </Button>
        <span className="text-xs text-muted">共 {query.data?.total ?? 0} 条</span>
      </header>
      <DataTable
        columns={columns}
        data={records}
        getRowId={(record) => record.id}
        loading={query.isLoading}
        error={query.error}
        emptyMessage={`暂无${recordTitle}`}
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
    </div>
  );
}
