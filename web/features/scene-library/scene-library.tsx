import { Download, Image as ImageIcon, Shuffle } from "lucide-react";
import { useMemo, useState } from "react";
import { AssetPageShell, AssetPageToolbar } from "@/components/domain/asset-page-shell";
import { ToolCreatorModal } from "@/components/domain/tool-creator-modal";
import { NativeSelect } from "@/components/ui/native-select";
import { type SceneCatalogEntry, sceneCatalog } from "../../../shared/scenes/scene-catalog";

const categories = ["全部分类", ...new Set(sceneCatalog.map((scene) => scene.category))];

export function SceneLibrary() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部分类");
  const [selected, setSelected] = useState<SceneCatalogEntry>();

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return sceneCatalog.filter(
      (scene) =>
        (category === "全部分类" || scene.category === category) &&
        (!keyword || `${scene.name} ${scene.description} ${scene.category}`.toLowerCase().includes(keyword)),
    );
  }, [category, query]);

  const selectRandomScene = () => {
    const candidates = filtered.length ? filtered : sceneCatalog;
    setSelected(candidates[Math.floor(Math.random() * candidates.length)]);
  };

  return (
    <>
      <AssetPageShell
        count={filtered.length}
        toolbar={
          <AssetPageToolbar
            query={query}
            onQueryChange={setQuery}
            placeholder="搜索场景名称或描述"
            actionLabel="随机场景"
            actionIcon={<Shuffle />}
            onAction={selectRandomScene}
            secondaryActions={
              <NativeSelect
                className="h-8"
                aria-label="场景分类"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                {categories.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </NativeSelect>
            }
          />
        }
      >
        <section className="grid h-full grid-cols-2 content-start gap-3 overflow-y-auto pb-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {filtered.map((scene) => (
            <button
              type="button"
              className="group overflow-hidden rounded-lg border border-line bg-white text-left transition hover:-translate-y-0.5 hover:border-line-strong hover:shadow-sm"
              key={scene.id}
              onClick={() => setSelected(scene)}
            >
              <div className="relative aspect-[4/5] overflow-hidden bg-surface-muted">
                <img
                  className="size-full object-cover transition duration-300 group-hover:scale-[1.02]"
                  src={scene.imageUrl}
                  alt={scene.name}
                  loading="lazy"
                />
                <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-1 text-2xs font-medium text-ink shadow-sm backdrop-blur-sm">
                  {scene.category}
                </span>
              </div>
              <div className="p-3">
                <h3 className="truncate text-sm font-medium text-ink">{scene.name}</h3>
                <p className="mt-1 line-clamp-2 text-xs text-muted">{scene.description}</p>
              </div>
            </button>
          ))}
          {!filtered.length && (
            <div className="col-span-full grid min-h-64 place-items-center text-xs text-muted">
              <span className="grid justify-items-center gap-2">
                <ImageIcon className="size-6" />
                没有符合条件的场景
              </span>
            </div>
          )}
        </section>
      </AssetPageShell>

      <ToolCreatorModal
        open={Boolean(selected)}
        title={selected?.name ?? "场景详情"}
        onClose={() => setSelected(undefined)}
      >
        {selected && (
          <>
            <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 sm:grid-cols-[minmax(0,1.35fr)_minmax(220px,0.65fr)]">
              <div className="overflow-hidden rounded-lg bg-surface-muted">
                <img className="size-full max-h-[520px] object-contain" src={selected.imageUrl} alt={selected.name} />
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                <span className="w-fit rounded-full bg-surface-strong px-2.5 py-1 text-xs font-medium text-ink">
                  {selected.category}
                </span>
                <p className="text-sm text-body">{selected.description}</p>
                <dl className="mt-auto grid gap-2 border-t border-line pt-3 text-xs">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">资产编号</dt>
                    <dd className="font-medium text-ink">SC-{String(selected.id).padStart(4, "0")}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">来源</dt>
                    <dd className="font-medium text-ink">通用场景库</dd>
                  </div>
                </dl>
              </div>
            </div>
            <footer className="flex h-13 flex-none items-center justify-end border-t border-line px-4">
              <a
                className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-white shadow-sm transition-colors hover:bg-primary/90 [&_svg]:size-4"
                href={selected.imageUrl}
                download={`${selected.name}.jpg`}
              >
                <Download />
                下载场景
              </a>
            </footer>
          </>
        )}
      </ToolCreatorModal>
    </>
  );
}
