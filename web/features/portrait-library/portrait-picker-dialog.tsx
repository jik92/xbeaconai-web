import { Check, LoaderCircle, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ToolCreatorModal } from "@/components/domain/tool-creator-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Portrait } from "./portrait-data";

export function PortraitPickerDialog({
  open,
  portraits,
  loading,
  selectedId,
  onClose,
  onSelect,
}: {
  open: boolean;
  portraits: Portrait[];
  loading: boolean;
  selectedId?: number;
  onClose: () => void;
  onSelect: (portrait: Portrait) => void;
}) {
  const [query, setQuery] = useState("");
  const [gender, setGender] = useState("全部");
  const [pendingId, setPendingId] = useState<number | undefined>(selectedId);
  const [limit, setLimit] = useState(60);
  useEffect(() => {
    if (!open) return;
    setPendingId(selectedId);
    setLimit(60);
  }, [open, selectedId]);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return portraits.filter(
      (portrait) =>
        (gender === "全部" || portrait.gender === gender) &&
        (!keyword || `${portrait.name} ${portrait.description} ${portrait.profession}`.toLowerCase().includes(keyword)),
    );
  }, [gender, portraits, query]);
  const pending = portraits.find((portrait) => portrait.index === pendingId);

  return (
    <ToolCreatorModal open={open} title="选择人像" onClose={onClose}>
      <div className="flex items-center gap-2 border-b border-line p-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            className="h-8 pl-9"
            value={query}
            placeholder="搜索职业、年龄或人物描述"
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(60);
            }}
          />
        </div>
        {[
          ["全部", "全部"],
          ["女", "女"],
          ["男", "男"],
        ].map(([label, value]) => (
          <Button
            className="h-8 rounded-full"
            key={value}
            size="sm"
            variant={gender === value ? "default" : "outline"}
            onClick={() => {
              setGender(value);
              setLimit(60);
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex min-h-48 items-center justify-center text-sm text-muted">
            <LoaderCircle className="mr-2 animate-spin" /> 正在加载人像库
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 max-[520px]:grid-cols-2">
            {filtered.slice(0, limit).map((portrait) => {
              const selected = portrait.index === pendingId;
              return (
                <button
                  type="button"
                  className={`relative overflow-hidden rounded-lg border bg-white text-left transition-colors ${
                    selected ? "border-primary ring-2 ring-primary/15" : "border-line hover:border-line-strong"
                  }`}
                  key={portrait.index}
                  aria-pressed={selected}
                  onClick={() => setPendingId(portrait.index)}
                >
                  <img className="aspect-[3/4] w-full object-cover" src={portrait.source_url} alt={portrait.name} />
                  {selected && (
                    <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-primary text-white">
                      <Check className="size-4" />
                    </span>
                  )}
                  <span className="block truncate px-2 pt-2 text-xs font-medium text-ink">{portrait.profession}</span>
                  <span className="block truncate px-2 pb-2 text-xs text-muted">
                    {portrait.age} 岁 · {portrait.gender}性 · NO.{String(portrait.index).padStart(4, "0")}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {!loading && !filtered.length && <p className="py-12 text-center text-sm text-muted">没有匹配的人像</p>}
        {limit < filtered.length && (
          <Button className="mt-3 w-full" size="sm" variant="outline" onClick={() => setLimit((value) => value + 60)}>
            加载更多（{Math.min(limit, filtered.length)}/{filtered.length}）
          </Button>
        )}
      </div>
      <footer className="flex h-16 shrink-0 items-center gap-3 border-t border-line px-3">
        {pending ? (
          <>
            <img className="h-11 w-9 rounded-md object-cover" src={pending.source_url} alt="" />
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{pending.name}</span>
          </>
        ) : (
          <span className="flex-1 text-sm text-muted">请选择一份人像</span>
        )}
        <Button variant="outline" size="sm" onClick={onClose}>
          取消
        </Button>
        <Button
          size="sm"
          disabled={!pending}
          onClick={() => {
            if (pending) onSelect(pending);
          }}
        >
          确认选择
        </Button>
      </footer>
    </ToolCreatorModal>
  );
}
