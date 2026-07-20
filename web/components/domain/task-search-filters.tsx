import { Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

export interface TaskSearchFilterValue {
  name: string;
  status: string;
  from: string;
  to: string;
}

interface TaskSearchFiltersProps {
  compact?: boolean;
  onSearch: (filters: TaskSearchFilterValue) => void;
}

const emptyFilters: TaskSearchFilterValue = { name: "", status: "", from: "", to: "" };

export function TaskSearchFilters({ compact = false, onSearch }: TaskSearchFiltersProps) {
  const [filters, setFilters] = useState(emptyFilters);

  const updateFilter = (key: keyof TaskSearchFilterValue, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const resetFilters = () => {
    setFilters(emptyFilters);
    onSearch(emptyFilters);
  };

  const applyFilters = () => onSearch({ ...filters, name: filters.name.trim() });

  return (
    <div
      className={cn(
        "grid grid-cols-1 items-end gap-3 sm:grid-cols-2",
        compact
          ? "lg:grid-cols-[minmax(190px,1fr)_160px_minmax(300px,1.35fr)_auto]"
          : "xl:grid-cols-[minmax(190px,1fr)_minmax(160px,0.8fr)_minmax(160px,0.8fr)_minmax(330px,1.5fr)_auto]",
      )}
    >
      <div className="space-y-1.5">
        <Label htmlFor="task-name-filter">任务名称</Label>
        <Input
          id="task-name-filter"
          value={filters.name}
          onChange={(event) => updateFilter("name", event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && applyFilters()}
          placeholder="请输入"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="task-status-filter">处理状态</Label>
        <NativeSelect
          id="task-status-filter"
          value={filters.status}
          onChange={(event) => updateFilter("status", event.target.value)}
        >
          <option value="">不限</option>
          <option value="queued">排队中</option>
          <option value="processing">生成中</option>
          <option value="succeeded">已完成</option>
          <option value="partially_succeeded">部分完成</option>
          <option value="failed">失败</option>
          <option value="cancelled">已取消</option>
        </NativeSelect>
      </div>
      {!compact && (
        <div className="space-y-1.5">
          <Label htmlFor="task-creator-filter">创建人</Label>
          <NativeSelect id="task-creator-filter" defaultValue="current">
            <option value="current">当前用户</option>
          </NativeSelect>
        </div>
      )}
      <div className={cn("space-y-1.5", compact ? "sm:col-span-2 lg:col-span-1" : "sm:col-span-2 xl:col-span-1")}>
        <Label htmlFor="task-date-from-filter">创建时间</Label>
        <div className="flex items-center gap-2">
          <Input
            id="task-date-from-filter"
            type="date"
            aria-label="开始日期"
            value={filters.from}
            onChange={(event) => updateFilter("from", event.target.value)}
          />
          <span className="text-sm text-muted">至</span>
          <Input
            type="date"
            aria-label="结束日期"
            value={filters.to}
            onChange={(event) => updateFilter("to", event.target.value)}
          />
        </div>
      </div>
      <div className="flex gap-2 sm:justify-end">
        <Button className="flex-1 sm:flex-none" variant="outline" onClick={resetFilters}>
          重置
        </Button>
        <Button className="flex-1 sm:flex-none" onClick={applyFilters}>
          <Search />
          查询
        </Button>
      </div>
    </div>
  );
}
