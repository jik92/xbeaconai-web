import { CalendarDays, Search } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { zhCN } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

function parseDate(value: string) {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function serializeDate(value: Date | undefined) {
  if (!value) return "";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayDate(value: Date | undefined) {
  return value?.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function TaskSearchFilters({ compact = false, onSearch }: TaskSearchFiltersProps) {
  const [filters, setFilters] = useState(emptyFilters);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const selectedRange: DateRange | undefined = filters.from
    ? { from: parseDate(filters.from), to: parseDate(filters.to) }
    : undefined;

  const updateFilter = (key: keyof TaskSearchFilterValue, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const resetFilters = () => {
    setFilters(emptyFilters);
    onSearch(emptyFilters);
  };

  const applyFilters = () => onSearch({ ...filters, name: filters.name.trim() });

  return (
    <div className={cn("flex w-full flex-nowrap items-center overflow-x-auto", compact ? "gap-2" : "gap-3 pb-1")}>
      <div className={cn("flex flex-1 items-center gap-2", compact ? "min-w-52" : "min-w-[260px]")}>
        <Label className={cn("shrink-0", compact && "text-xs")} htmlFor="task-name-filter">
          任务名称
        </Label>
        <Input
          className={cn(compact && "h-8")}
          id="task-name-filter"
          value={filters.name}
          onChange={(event) => updateFilter("name", event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && applyFilters()}
          placeholder="请输入"
        />
      </div>
      <div className={cn("flex shrink-0 items-center gap-2", compact ? "w-44" : "w-[210px]")}>
        <Label className={cn("shrink-0", compact && "text-xs")} htmlFor="task-status-filter">
          处理状态
        </Label>
        <NativeSelect
          className={cn(compact && "h-8")}
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
      <div className={cn("flex shrink-0 items-center gap-2", compact ? "w-72" : "w-[340px]")}>
        <Label className={cn("shrink-0", compact && "text-xs")} htmlFor="task-date-filter">
          创建时间
        </Label>
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              id="task-date-filter"
              className="min-w-0 flex-1 justify-start px-3 font-normal"
              size={compact ? "sm" : "default"}
              variant="outline"
            >
              <CalendarDays />
              <span className="truncate">
                {selectedRange?.from
                  ? `${displayDate(selectedRange.from)}${selectedRange.to ? ` - ${displayDate(selectedRange.to)}` : ""}`
                  : "选择日期范围"}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end">
            <Calendar
              mode="range"
              locale={zhCN}
              selected={selectedRange}
              resetOnSelect
              onSelect={(range) => {
                setFilters((current) => ({
                  ...current,
                  from: serializeDate(range?.from),
                  to: serializeDate(range?.to),
                }));
                if (range?.from && range.to) setCalendarOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size={compact ? "sm" : "default"} variant="outline" onClick={resetFilters}>
          重置
        </Button>
        <Button size={compact ? "sm" : "default"} onClick={applyFilters}>
          <Search />
          查询
        </Button>
      </div>
    </div>
  );
}
