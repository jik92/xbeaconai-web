import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Check, LoaderCircle, Pencil, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

export type ProjectRecordStatusTone = "neutral" | "progress" | "success" | "error";

export interface ProjectRecordItem {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  statusTone?: ProjectRecordStatusTone;
  summary: string;
  updatedAt: string;
  createdBy?: string;
  revision?: number;
}

export interface ProjectRecordPage {
  items: ProjectRecordItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface ProjectRecordDrawerProps {
  open: boolean;
  queryKey: string;
  currentProjectId?: string;
  statusOptions: Array<{ value: string; label: string }>;
  fetchPage: (input: { query?: string; status?: string; page: number; pageSize: number }) => Promise<ProjectRecordPage>;
  onClose: () => void;
  onContinue: (item: ProjectRecordItem) => void | Promise<void>;
  onRename?: (item: ProjectRecordItem, title: string) => void | Promise<void>;
  onRenamed?: (projectId: string, title: string) => void;
}

const statusToneClasses: Record<ProjectRecordStatusTone, string> = {
  neutral: "bg-surface-strong text-ink",
  progress: "bg-canvas-soft text-body-strong",
  success: "bg-canvas-soft text-success",
  error: "bg-canvas-soft text-error",
};

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function ProjectRecordDrawer({
  open,
  queryKey,
  currentProjectId,
  statusOptions,
  fetchPage,
  onClose,
  onContinue,
  onRename,
  onRenamed,
}: ProjectRecordDrawerProps) {
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [status, setStatus] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingTitle, setEditingTitle] = useState("");
  const [busyId, setBusyId] = useState("");
  const [actionError, setActionError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const history = useInfiniteQuery({
    queryKey: [queryKey, appliedQuery, status],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      fetchPage({
        query: appliedQuery || undefined,
        status: status || undefined,
        page: pageParam,
        pageSize: 20,
      }),
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.pageSize < lastPage.total ? lastPage.page + 1 : undefined,
    enabled: open,
  });
  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  const total = history.data?.pages[0]?.total ?? 0;

  useEffect(() => {
    const target = loadMoreRef.current;
    const root = listRef.current;
    if (
      !open ||
      !target ||
      !root ||
      !history.hasNextPage ||
      history.isFetchingNextPage ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void history.fetchNextPage();
      },
      { root, rootMargin: "120px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [history.fetchNextPage, history.hasNextPage, history.isFetchingNextPage, open]);

  const renameItem = async (item: ProjectRecordItem) => {
    if (!onRename) return;
    const title = editingTitle.trim();
    if (!title || title === item.title) {
      setEditingId("");
      return;
    }
    setBusyId(item.id);
    setActionError("");
    try {
      await onRename(item, title);
      onRenamed?.(item.id, title);
      setEditingId("");
      await history.refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "项目重命名失败");
    } finally {
      setBusyId("");
    }
  };

  const continueItem = async (item: ProjectRecordItem) => {
    setBusyId(item.id);
    setActionError("");
    try {
      await onContinue(item);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "项目恢复失败");
    } finally {
      setBusyId("");
    }
  };

  const requestError = history.error instanceof Error ? history.error.message : history.error ? "生成记录加载失败" : "";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-surface-dark/40" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-line bg-surface shadow-lg outline-none">
          <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-line px-4">
            <DialogPrimitive.Title className="type-section-title text-ink">生成记录</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" className="size-8" aria-label="关闭生成记录">
                <X />
              </Button>
            </DialogPrimitive.Close>
          </header>

          <form
            className="flex shrink-0 items-center gap-2 border-b border-line p-3"
            onSubmit={(event) => {
              event.preventDefault();
              setAppliedQuery(query.trim());
              setEditingId("");
              setActionError("");
            }}
          >
            <Input
              className="min-w-0 flex-1"
              value={query}
              placeholder="搜索项目名称"
              aria-label="搜索项目名称"
              onChange={(event) => setQuery(event.target.value)}
            />
            <NativeSelect
              aria-label="项目状态"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setEditingId("");
                setActionError("");
              }}
            >
              <option value="">全部状态</option>
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
            <Button type="submit" variant="outline" size="icon-sm" className="size-9" aria-label="查询生成记录">
              <Search />
            </Button>
          </form>

          {(actionError || requestError) && (
            <div className="mx-3 mt-3 flex items-center gap-2 rounded-md bg-canvas-soft px-3 py-2 type-helper text-error">
              <span className="min-w-0 flex-1">{actionError || requestError}</span>
              {requestError && (
                <Button variant="ghost" size="sm" onClick={() => void history.refetch()}>
                  <RotateCcw />
                  重试
                </Button>
              )}
            </div>
          )}

          <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {items.map((item) => {
              const editing = editingId === item.id;
              const busy = busyId === item.id;
              const current = currentProjectId === item.id;
              return (
                <article
                  key={item.id}
                  className={cn(
                    "rounded-lg border border-line bg-surface p-3",
                    current && "border-line-strong bg-canvas-soft",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 type-badge",
                        statusToneClasses[item.statusTone ?? "neutral"],
                      )}
                    >
                      {item.statusLabel}
                    </span>
                    {editing ? (
                      <Input
                        className="h-8 min-w-0 flex-1"
                        value={editingTitle}
                        maxLength={80}
                        disabled={busy}
                        aria-label={`重命名 ${item.title}`}
                        onChange={(event) => setEditingTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void renameItem(item);
                          }
                          if (event.key === "Escape") setEditingId("");
                        }}
                      />
                    ) : (
                      <h3 className="min-w-0 flex-1 truncate type-card-title text-ink">{item.title}</h3>
                    )}
                    {current && <span className="shrink-0 type-badge text-muted">当前项目</span>}
                    {editing ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-8"
                        disabled={busy}
                        aria-label={`保存 ${item.title}`}
                        onClick={() => void renameItem(item)}
                      >
                        {busy ? <LoaderCircle className="animate-spin" /> : <Check />}
                      </Button>
                    ) : onRename ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-8"
                        disabled={busy}
                        aria-label={`重命名 ${item.title}`}
                        onClick={() => {
                          setEditingId(item.id);
                          setEditingTitle(item.title);
                          setActionError("");
                        }}
                      >
                        <Pencil />
                      </Button>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate type-helper text-body">{item.summary}</p>
                  <div className="mt-2 flex items-center justify-between gap-3 border-t border-line-soft pt-2">
                    <span className="min-w-0 truncate type-helper text-muted">
                      {item.createdBy ? `${item.createdBy} · ` : ""}
                      {formatUpdatedAt(item.updatedAt)}
                    </span>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => void continueItem(item)}>
                      {busy && !editing ? <LoaderCircle className="animate-spin" /> : null}
                      {busy && !editing ? "加载中" : "继续创作"}
                    </Button>
                  </div>
                </article>
              );
            })}
            {history.isLoading && (
              <div className="grid min-h-32 place-items-center type-helper text-muted">正在加载生成记录…</div>
            )}
            {!history.isLoading && !requestError && !items.length && (
              <div className="grid min-h-32 place-items-center type-helper text-muted">暂无生成记录</div>
            )}
            <div ref={loadMoreRef} className="h-px" />
          </div>

          <footer className="flex h-[52px] shrink-0 items-center justify-between gap-3 border-t border-line px-4">
            <span className="type-helper text-muted">
              已加载 {items.length}/{total} 条
            </span>
            {history.hasNextPage && (
              <Button
                variant="outline"
                size="sm"
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                {history.isFetchingNextPage && <LoaderCircle className="animate-spin" />}
                {history.isFetchingNextPage ? "加载中" : "加载更多"}
              </Button>
            )}
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
