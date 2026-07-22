import { useQuery } from "@tanstack/react-query";
import { AudioLines, FileClock, Files, Package, Search, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAllJobs, fetchLibraryAssets, fetchProducts } from "@/api/api-client";
import { Button } from "@/components/ui/button";
import { fetchPortraits } from "@/features/portrait-library/portrait-data";
import { cn } from "@/lib/utils";
import { buildGlobalSearchResults, type GlobalSearchPage, type GlobalSearchResultKind } from "./global-search-index";

interface GlobalSearchProps {
  pages: GlobalSearchPage[];
}

const resultIcons = {
  page: Search,
  task: FileClock,
  material: Files,
  product: Package,
  voice: AudioLines,
  portrait: UserRound,
} satisfies Record<GlobalSearchResultKind, typeof Search>;

export function isGlobalSearchShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}) {
  return event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
}

export function GlobalSearch({ pages }: GlobalSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasPage = (path: string) => pages.some((page) => page.path === path);
  const hasTaskPages = pages.some((page) => page.id.startsWith("module:"));
  const jobs = useQuery({
    queryKey: ["global-search", "jobs"],
    queryFn: fetchAllJobs,
    enabled: open && hasTaskPages,
    staleTime: 30_000,
  });
  const materials = useQuery({
    queryKey: ["asset-library", "media", ""],
    queryFn: () => fetchLibraryAssets("media"),
    enabled: open && hasPage("/assets/materials"),
    staleTime: 30_000,
  });
  const products = useQuery({
    queryKey: ["product-library"],
    queryFn: fetchProducts,
    enabled: open && hasPage("/assets/products"),
    staleTime: 30_000,
  });
  const voices = useQuery({
    queryKey: ["asset-library", "voice"],
    queryFn: () => fetchLibraryAssets("voice"),
    enabled: open && hasPage("/assets/voices"),
    staleTime: 30_000,
  });
  const portraits = useQuery({
    queryKey: ["portrait-library"],
    queryFn: fetchPortraits,
    enabled: open && hasPage("/assets/portraits"),
    staleTime: Infinity,
  });
  const results = useMemo(
    () =>
      buildGlobalSearchResults(
        {
          pages,
          jobs: jobs.data,
          materials: materials.data,
          products: products.data,
          voices: voices.data,
          portraits: portraits.data,
        },
        query,
      ),
    [jobs.data, materials.data, pages, portraits.data, products.data, query, voices.data],
  );
  const groupedResults = useMemo(
    () =>
      results.reduce<Array<{ section: string; items: typeof results }>>((groups, result) => {
        const existing = groups.find((group) => group.section === result.section);
        if (existing) existing.items.push(result);
        else groups.push({ section: result.section, items: [result] });
        return groups;
      }, []),
    [results],
  );
  const loading = query.trim() && [jobs, materials, products, voices, portraits].some((item) => item.isFetching);
  const partialError = [jobs, materials, products, voices, portraits].some((item) => item.isError);
  const shortcut = /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "⌘ K" : "Ctrl K";
  const currentIndex = Math.min(activeIndex, Math.max(0, results.length - 1));

  const openSearch = useCallback(() => {
    setOpen(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);
  const closeSearch = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, []);
  const selectResult = (index: number) => {
    const result = results[index];
    if (!result) return;
    closeSearch();
    window.location.assign(result.href);
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!isGlobalSearchShortcut(event)) return;
      event.preventDefault();
      openSearch();
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [openSearch]);
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeSearch();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [closeSearch, open]);

  return (
    <div className="global-search" ref={rootRef}>
      <Search size={16} aria-hidden="true" />
      <input
        ref={inputRef}
        value={query}
        placeholder="搜索页面、任务或素材"
        role="combobox"
        aria-expanded={open}
        aria-controls="global-search-results"
        aria-activedescendant={results[currentIndex] ? `global-search-${results[currentIndex].id}` : undefined}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((index) => Math.min(index + 1, results.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            selectResult(currentIndex);
          } else if (event.key === "Escape") {
            event.preventDefault();
            closeSearch();
            inputRef.current?.blur();
          }
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        className="global-search-shortcut h-6 px-1.5 text-2xs text-muted"
        aria-label={`打开全局搜索，快捷键 ${shortcut}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={openSearch}
      >
        {shortcut}
      </Button>
      {open && (
        <div
          id="global-search-results"
          className="absolute left-1/2 top-full z-50 mt-2 flex max-h-[min(520px,70vh)] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 flex-col overflow-y-auto rounded-lg border border-line bg-white p-1 shadow-xl"
          role="listbox"
        >
          {groupedResults.map((group) => (
            <section key={group.section} className="border-b border-line/60 py-1 last:border-0">
              <b className="block px-2 py-1 text-2xs font-medium text-muted">{group.section}</b>
              {group.items.map((result) => {
                const index = results.indexOf(result);
                const Icon = resultIcons[result.kind];
                return (
                  <button
                    type="button"
                    id={`global-search-${result.id}`}
                    key={result.id}
                    className={cn(
                      "flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left",
                      index === currentIndex ? "bg-surface-muted" : "hover:bg-surface-muted/70",
                    )}
                    role="option"
                    aria-selected={index === currentIndex}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectResult(index)}
                  >
                    <Icon className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-xs font-medium text-ink">{result.label}</b>
                      <small className="block truncate text-2xs text-muted">{result.meta}</small>
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
          {!results.length && (
            <div className="grid min-h-24 place-items-center px-3 text-xs text-muted">
              {loading ? "正在搜索…" : "没有匹配结果"}
            </div>
          )}
          {partialError && <small className="px-2 py-1 text-2xs text-warning">部分数据暂时无法搜索</small>}
        </div>
      )}
    </div>
  );
}
