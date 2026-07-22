import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TaskSearchFilters, type TaskSearchFilterValue } from "./task-search-filters";

interface ToolTaskPageProps {
  actionLabel: string;
  onAction: () => void;
  onSearch: (filters: TaskSearchFilterValue) => void;
  count: number;
  totalCount?: number;
  children: ReactNode;
}

export function createToolTaskLabel(toolName: string) {
  return `新建${toolName}任务`;
}

export function ToolTaskPage({
  actionLabel,
  onAction,
  onSearch,
  count,
  totalCount = count,
  children,
}: ToolTaskPageProps) {
  return (
    <main className="flex h-[calc(100vh-80px)] min-h-[520px] flex-col overflow-hidden bg-white p-3">
      <div className="flex flex-none items-center gap-2">
        <TaskSearchFilters compact onSearch={onSearch} />
        <Button size="sm" onClick={onAction}>
          <Plus />
          {actionLabel}
        </Button>
      </div>
      <div className="mt-2 flex min-h-0 flex-1 flex-col">{children}</div>
      <small className="flex flex-none justify-end pt-1 text-2xs text-muted">
        共 {count} 个任务{count !== totalCount && ` / 全部 ${totalCount} 个`}
      </small>
    </main>
  );
}
