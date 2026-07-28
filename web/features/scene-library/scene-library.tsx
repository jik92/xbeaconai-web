import { Download, Image as ImageIcon, Shuffle } from "lucide-react";
import { useMemo, useState } from "react";
import { AssetPageShell, AssetPageToolbar } from "@/components/domain/asset-page-shell";
import { ToolCreatorModal } from "@/components/domain/tool-creator-modal";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { type SceneCatalogEntry, sceneCatalog } from "../../../shared/scenes/scene-catalog";

const spaceTypes = ["全部空间", ...new Set(sceneCatalog.map((scene) => scene.spaceType))];
const sceneAttributes = ["全部属性", ...new Set(sceneCatalog.map((scene) => scene.sceneAttribute))];

export function sceneTags(scene: SceneCatalogEntry): readonly string[] {
  return [
    scene.spaceType,
    scene.sceneAttribute,
    scene.sceneType,
    scene.style,
    scene.lighting,
    scene.applicableCategories.join("、"),
  ];
}

export function SceneLibrary() {
  const [query, setQuery] = useState("");
  const [spaceType, setSpaceType] = useState("全部空间");
  const [sceneAttribute, setSceneAttribute] = useState("全部属性");
  const [selected, setSelected] = useState<SceneCatalogEntry>();

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return sceneCatalog.filter(
      (scene) =>
        (spaceType === "全部空间" || scene.spaceType === spaceType) &&
        (sceneAttribute === "全部属性" || scene.sceneAttribute === sceneAttribute) &&
        (!keyword ||
          `${scene.name} ${scene.description} ${sceneTags(scene).join(" ")}`.toLowerCase().includes(keyword)),
    );
  }, [query, sceneAttribute, spaceType]);

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
            placeholder="搜索场景名称、描述或 Tag"
            actionLabel="随机场景"
            actionIcon={<Shuffle />}
            onAction={selectRandomScene}
            secondaryActions={
              <>
                <NativeSelect
                  className="h-8"
                  aria-label="空间类型"
                  value={spaceType}
                  onChange={(event) => setSpaceType(event.target.value)}
                >
                  {spaceTypes.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </NativeSelect>
                <NativeSelect
                  className="h-8"
                  aria-label="场景属性"
                  value={sceneAttribute}
                  onChange={(event) => setSceneAttribute(event.target.value)}
                >
                  {sceneAttributes.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </NativeSelect>
              </>
            }
          />
        }
      >
        <section className="grid min-h-0 flex-1 auto-rows-max grid-cols-2 content-start items-start gap-3 overflow-y-auto pb-3 md:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12">
          {filtered.map((scene) => (
            <Button
              type="button"
              variant="ghost"
              className="group h-auto w-full flex-col items-stretch justify-start gap-0 whitespace-normal self-start overflow-hidden rounded-lg border border-line bg-surface p-0 text-left transition hover:-translate-y-0.5 hover:border-line-strong hover:bg-surface hover:shadow-sm"
              key={scene.id}
              onClick={() => setSelected(scene)}
            >
              <div className="relative overflow-hidden bg-surface-muted">
                <img
                  className="block h-auto w-full object-contain transition duration-300 group-hover:scale-[1.02]"
                  src={scene.thumbnailUrl}
                  alt={scene.name}
                  loading="lazy"
                />
                <span className="absolute left-2 top-2 rounded-full bg-surface/90 px-2 py-1 type-micro-strong text-ink shadow-sm backdrop-blur-sm">
                  {scene.sceneType}
                </span>
              </div>
              <div className="p-3">
                <h3 className="truncate type-card-title text-ink">{scene.name}</h3>
                <p className="mt-1 line-clamp-2 type-helper text-muted">{scene.description}</p>
              </div>
            </Button>
          ))}
          {!filtered.length && (
            <div className="col-span-full grid min-h-64 place-items-center type-helper text-muted">
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
                <div className="flex flex-wrap gap-1.5">
                  {sceneTags(selected).map((tag) => (
                    <span className="rounded-full bg-surface-strong px-2.5 py-1 type-label text-ink" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="type-body text-body">{selected.description}</p>
                <dl className="mt-auto grid gap-2 border-t border-line pt-3 type-helper">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">资产编号</dt>
                    <dd className="type-body-strong text-ink">SC-{String(selected.id).padStart(4, "0")}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">来源</dt>
                    <dd className="type-body-strong text-ink">通用场景库</dd>
                  </div>
                </dl>
              </div>
            </div>
            <footer className="flex h-13 flex-none items-center justify-end border-t border-line px-4">
              <a
                className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-primary px-3 type-label text-on-primary shadow-sm transition-colors hover:bg-primary/90 [&_svg]:size-4"
                href={selected.originalUrl}
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
