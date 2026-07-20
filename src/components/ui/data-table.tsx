import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import clsx from "clsx";
import type { CSSProperties, ReactNode } from "react";
import "./data-table.css";

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
  minWidth?: number;
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
  minWidth = 760,
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
    <div className={clsx("data-table-wrap", className)} style={{ height }} aria-busy={loading || undefined}>
      <table className="data-table" style={{ minWidth }}>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} style={{ width: header.getSize() }} colSpan={header.colSpan}>
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {!loading &&
            !error &&
            rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            ))}
          {(loading || error || !rows.length) && (
            <tr>
              <td colSpan={Math.max(1, table.getVisibleLeafColumns().length)}>
                <div className={clsx("data-table-state", Boolean(error) && "error")}>
                  {emptyIcon}
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
