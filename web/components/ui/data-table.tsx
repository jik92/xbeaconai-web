import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  getRowId?: (row: TData, index: number) => string;
  loading?: boolean;
  loadingMessage?: string;
  error?: unknown;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  emptyAction?: ReactNode;
  className?: string;
  height?: CSSProperties["height"];
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "数据加载失败";
}

export function DataTable<TData>({
  columns,
  data,
  getRowId,
  loading = false,
  loadingMessage = "正在加载…",
  error,
  emptyMessage = "暂无数据",
  emptyIcon,
  emptyAction,
  className,
  height,
}: DataTableProps<TData>) {
  const table = useReactTable({
    columns,
    data,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
  });
  const rows = table.getRowModel().rows;
  const stateMessage = loading ? loadingMessage : error ? getErrorMessage(error) : emptyMessage;

  return (
    <div
      className={cn("relative min-h-0 w-full overflow-x-hidden overflow-y-auto", className)}
      style={{ height }}
      aria-busy={loading || undefined}
    >
      <table className="w-full table-fixed border-collapse text-xs">
        <thead className="[&_tr]:border-b [&_tr]:border-line">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="sticky top-0 z-10 h-10 overflow-hidden text-ellipsis whitespace-nowrap px-2 text-left align-middle font-medium text-muted"
                  style={{ width: `${(header.getSize() / table.getTotalSize()) * 100}%` }}
                  colSpan={header.colSpan}
                >
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="[&_tr:last-child]:border-0">
          {!loading &&
            !error &&
            rows.map((row) => (
              <tr key={row.id} className="border-b border-line/60 transition-colors hover:bg-surface-muted/50">
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="h-14 max-w-0 overflow-hidden text-ellipsis whitespace-nowrap p-2 align-middle text-ink/75"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          {(loading || error || !rows.length) && (
            <tr>
              <td colSpan={Math.max(1, table.getVisibleLeafColumns().length)}>
                <div
                  className={cn(
                    "flex flex-col items-center justify-center text-muted [&>b]:mt-3 [&>svg]:size-10 [&_button]:mt-3",
                    "min-h-48",
                    Boolean(error) && "text-red-600",
                  )}
                >
                  <b>{stateMessage}</b>
                  {!loading && !error && emptyAction}
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
