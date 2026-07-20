import { Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

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
    <div className="flex w-full flex-nowrap items-center gap-3 overflow-x-auto pb-1">
      <div className="flex min-w-[260px] flex-1 items-center gap-2">
        <Label className="shrink-0" htmlFor="task-name-filter">
          任务名称
        </Label>
        <Input
          id="task-name-filter"
          value={filters.name}
          onChange={(event) => updateFilter("name", event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && applyFilters()}
          placeholder="请输入"
        />
      </div>
      <div className="flex w-[210px] shrink-0 items-center gap-2">
        <Label className="shrink-0" htmlFor="task-status-filter">
          处理状态
        </Label>
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
        <div className="flex w-[210px] shrink-0 items-center gap-2">
          <Label className="shrink-0" htmlFor="task-creator-filter">
            创建人
          </Label>
          <NativeSelect id="task-creator-filter" defaultValue="current">
            <option value="current">当前用户</option>
          </NativeSelect>
        </div>
      )}
      <div className="flex w-[390px] shrink-0 items-center gap-2">
        <Label className="shrink-0" htmlFor="task-date-from-filter">
          创建时间
        </Label>
        <Input
          id="task-date-from-filter"
          type="date"
          aria-label="开始日期"
          value={filters.from}
          onChange={(event) => updateFilter("from", event.target.value)}
        />
        <span className="shrink-0 text-sm text-muted">至</span>
        <Input
          type="date"
          aria-label="结束日期"
          value={filters.to}
          onChange={(event) => updateFilter("to", event.target.value)}
        />
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="outline" onClick={resetFilters}>
          重置
        </Button>
        <Button onClick={applyFilters}>
          <Search />
          查询
        </Button>
      </div>
    </div>
  );
}
