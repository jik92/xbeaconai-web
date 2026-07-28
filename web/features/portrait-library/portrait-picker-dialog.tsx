import { Check, LoaderCircle, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ImagePreview, MediaPreview } from "@/components/domain/media-preview";
import { ToolCreatorModal } from "@/components/domain/tool-creator-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Portrait } from "./portrait-data";

export function PortraitPickerDialog({
  open,
  portraits,
  loading,
  error,
  selectedKeys,
  maxSelect = 1,
  onClose,
  onConfirm,
}: {
  open: boolean;
  portraits: Portrait[];
  loading: boolean;
  error?: unknown;
  selectedKeys: string[];
  maxSelect?: number;
  onClose: () => void;
  onConfirm: (portraits: Portrait[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [gender, setGender] = useState("全部");
  const [source, setSource] = useState<"general" | "custom">("general");
  const [pendingKeys, setPendingKeys] = useState<string[]>(() => selectedKeys.slice(0, maxSelect));
  const [limit, setLimit] = useState(60);
  const selectedKeysSignature = selectedKeys.slice(0, maxSelect).join("\u0000");
  useEffect(() => {
    if (!open) return;
    const nextKeys = selectedKeysSignature ? selectedKeysSignature.split("\u0000") : [];
    setPendingKeys(nextKeys);
    const selected = portraits.find((portrait) => portrait.key === nextKeys[0]);
    setSource(selected?.type ?? "general");
    setLimit(60);
  }, [open, portraits, selectedKeysSignature]);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return portraits.filter(
      (portrait) =>
        portrait.status === "active" &&
        portrait.type === source &&
        (gender === "全部" || portrait.gender === gender) &&
        (!keyword || `${portrait.name} ${portrait.description} ${portrait.profession}`.toLowerCase().includes(keyword)),
    );
  }, [gender, portraits, query, source]);
  const pending = pendingKeys.flatMap((key) => {
    const portrait = portraits.find((item) => item.key === key);
    return portrait ? [portrait] : [];
  });
  const togglePortrait = (portrait: Portrait) => {
    setPendingKeys((current) => {
      if (current.includes(portrait.key)) return current.filter((key) => key !== portrait.key);
      if (maxSelect === 1) return [portrait.key];
      if (current.length >= maxSelect) return current;
      return [...current, portrait.key];
    });
  };

  return (
    <ToolCreatorModal
      open={open}
      title={maxSelect > 1 ? `选择人像（最多 ${maxSelect} 个）` : "选择人像"}
      onClose={onClose}
    >
      <div className="flex items-center gap-2 border-b border-line p-3">
        {(["general", "custom"] as const).map((value) => (
          <Button
            className="h-8"
            key={value}
            size="sm"
            variant={source === value ? "default" : "outline"}
            onClick={() => {
              setSource(value);
              setLimit(60);
            }}
          >
            {value === "general" ? "通用虚拟人像" : "自建虚拟人像"}
          </Button>
        ))}
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
      {maxSelect > 1 && pendingKeys.length >= maxSelect && (
        <div className="bg-surface-strong px-3 py-2 type-helper text-muted">
          已选择 {maxSelect} 个人像，如需更换请先取消已有选择。
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex min-h-48 items-center justify-center type-body text-muted">
            <LoaderCircle className="mr-2 animate-spin" /> 正在加载人像库
          </div>
        ) : error ? (
          <div className="flex min-h-48 items-center justify-center type-body text-error">
            {error instanceof Error ? error.message : "人像清单加载失败"}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 max-[520px]:grid-cols-2">
            {filtered.slice(0, limit).map((portrait) => {
              const selected = pendingKeys.includes(portrait.key);
              return (
                <Button
                  type="button"
                  variant="ghost"
                  className={`relative h-auto w-full flex-col items-stretch justify-start gap-0 overflow-hidden whitespace-normal rounded-lg border bg-surface p-0 text-left transition-colors hover:bg-surface ${
                    selected ? "border-primary ring-2 ring-primary/15" : "border-line hover:border-line-strong"
                  }`}
                  key={portrait.key}
                  aria-pressed={selected}
                  onClick={() => togglePortrait(portrait)}
                >
                  {portrait.type === "custom" ? (
                    <MediaPreview
                      className="aspect-[3/4] w-full object-cover"
                      url={portrait.thumbnail_url}
                      mimeType="image/jpeg"
                      alt={portrait.name}
                      previewable={false}
                    />
                  ) : (
                    <ImagePreview
                      className="aspect-[3/4] w-full object-cover"
                      src={portrait.thumbnail_url}
                      alt={portrait.name}
                    />
                  )}
                  {selected && (
                    <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-primary text-on-primary">
                      <Check className="size-4" />
                    </span>
                  )}
                  <span className="block truncate px-2 pt-2 type-label text-ink">{portrait.profession}</span>
                  <span className="block truncate px-2 pb-2 type-helper text-muted">
                    {portrait.type === "general"
                      ? `${portrait.age} 岁 · ${portrait.gender}性 · NO.${String(portrait.index).padStart(4, "0")}`
                      : "自建虚拟人像"}
                  </span>
                </Button>
              );
            })}
          </div>
        )}
        {!loading && !error && !filtered.length && (
          <p className="py-12 text-center type-body text-muted">没有匹配的人像</p>
        )}
        {limit < filtered.length && (
          <Button className="mt-3 w-full" size="sm" variant="outline" onClick={() => setLimit((value) => value + 60)}>
            加载更多（{Math.min(limit, filtered.length)}/{filtered.length}）
          </Button>
        )}
      </div>
      <footer className="flex h-16 shrink-0 items-center gap-3 border-t border-line px-3">
        {pending.length ? (
          <>
            <div className="flex shrink-0 -space-x-1">
              {pending.map((portrait) =>
                portrait.type === "custom" ? (
                  <MediaPreview
                    className="h-11 w-9 rounded-md border border-surface object-cover"
                    key={portrait.key}
                    url={portrait.thumbnail_url}
                    mimeType="image/jpeg"
                    alt=""
                    previewable={false}
                  />
                ) : (
                  <ImagePreview
                    className="h-11 w-9 rounded-md border border-surface object-cover"
                    key={portrait.key}
                    src={portrait.thumbnail_url}
                    alt=""
                  />
                ),
              )}
            </div>
            <span className="min-w-0 flex-1 truncate type-body text-ink">
              {maxSelect > 1
                ? `已选择 ${pending.length}/${maxSelect}：${pending.map((item) => item.name).join("、")}`
                : pending[0]?.name}
            </span>
          </>
        ) : (
          <span className="flex-1 type-body text-muted">请选择一份人像</span>
        )}
        <Button variant="outline" size="sm" onClick={onClose}>
          取消
        </Button>
        <Button
          size="sm"
          disabled={!pending.length}
          onClick={() => {
            if (pending.length) onConfirm(pending);
          }}
        >
          确认选择
        </Button>
      </footer>
    </ToolCreatorModal>
  );
}
