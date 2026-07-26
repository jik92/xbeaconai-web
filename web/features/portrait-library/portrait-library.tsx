import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Download, Images, LoaderCircle, Shuffle, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createCustomPortrait } from "@/api/api-client";
import { AssetPageShell, AssetPageToolbar } from "@/components/domain/asset-page-shell";
import { MediaPreview } from "@/components/domain/media-preview";
import { ToolCreatorModal } from "@/components/domain/tool-creator-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { PortraitGender } from "../../../shared/portraits/portrait-tags";
import { fetchPortraits, type Portrait } from "./portrait-data";

const getPortraitColumns = () =>
  window.innerWidth > 1600 ? 6 : window.innerWidth > 1250 ? 5 : window.innerWidth > 800 ? 4 : 2;

export function PortraitLibrary() {
  const queryClient = useQueryClient();
  const requestedPortraitId = Number(new URLSearchParams(window.location.search).get("portraitId"));
  const requestedPortraitAssetId = new URLSearchParams(window.location.search).get("portraitAssetId");
  const { data = [], isLoading } = useQuery({
    queryKey: ["portrait-library"],
    queryFn: fetchPortraits,
    staleTime: 30_000,
    refetchInterval: 5_000,
  });
  const [source, setSource] = useState<"general" | "custom">("general");
  const [query, setQuery] = useState("");
  const [gender, setGender] = useState("全部");
  const [age, setAge] = useState("全部年龄");
  const [profession, setProfession] = useState("全部职业");
  const [selected, setSelected] = useState<Portrait | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [portraitFile, setPortraitFile] = useState<File | null>(null);
  const [portraitName, setPortraitName] = useState("");
  const [portraitGender, setPortraitGender] = useState<PortraitGender | "">("");
  const [portraitDescription, setPortraitDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [columns, setColumns] = useState(getPortraitColumns);
  const viewport = useRef<HTMLDivElement>(null);
  const requestedPortraitLocated = useRef(false);
  useEffect(() => {
    if ((!requestedPortraitId && !requestedPortraitAssetId) || requestedPortraitLocated.current) return;
    const portrait = data.find((item) =>
      item.type === "general" ? item.index === requestedPortraitId : item.assetId === requestedPortraitAssetId,
    );
    if (portrait) {
      requestedPortraitLocated.current = true;
      setSource(portrait.type);
      setSelected(portrait);
    }
  }, [data, requestedPortraitAssetId, requestedPortraitId]);
  useEffect(() => {
    const resize = () => setColumns(getPortraitColumns());
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const professions = useMemo(
    () => [
      "全部职业",
      ...Array.from(new Set(data.filter((item) => item.type === source).map((item) => item.profession))).sort((a, b) =>
        a.localeCompare(b, "zh-CN"),
      ),
    ],
    [data, source],
  );
  const filtered = useMemo(
    () =>
      data.filter((item) => {
        if (item.type !== source) return false;
        const text = `${item.name} ${item.description}`.toLowerCase();
        const ageMatch =
          age === "全部年龄" ||
          (age === "18–29 岁" && item.age < 30) ||
          (age === "30–49 岁" && item.age >= 30 && item.age < 50) ||
          (age === "50 岁以上" && item.age >= 50);
        return (
          (!query || text.includes(query.toLowerCase())) &&
          (gender === "全部" || item.gender === gender) &&
          ageMatch &&
          (profession === "全部职业" || item.profession === profession)
        );
      }),
    [age, data, gender, profession, query, source],
  );
  const rows = Math.ceil(filtered.length / columns);
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => viewport.current,
    estimateSize: () => 330,
    overscan: 3,
  });
  const random = () => setSelected(filtered[Math.floor(Math.random() * filtered.length)] || data[0] || null);
  const useForCreation = () => {
    if (!selected) return;
    localStorage.setItem(
      "studio:selectedPortrait",
      JSON.stringify({
        name: selected.name,
        profession: selected.profession,
        source_url: selected.source_url,
        key: selected.key,
        reference: selected.reference,
        ...(selected.type === "general" ? { index: selected.index } : {}),
        description: selected.description,
        gender: selected.gender,
        age: selected.age,
      }),
    );
    window.location.assign("/aigc/video-remix");
  };
  return (
    <>
      <AssetPageShell
        count={filtered.length}
        toolbar={
          <div className="space-y-2">
            <AssetPageToolbar
              query={query}
              onQueryChange={setQuery}
              placeholder="搜索职业、年龄或人物描述"
              actionLabel="新建人像"
              actionIcon={<UserRound />}
              onAction={() => {
                setCreateError("");
                setCreateOpen(true);
              }}
              secondaryActions={
                <Button size="sm" variant="outline" onClick={random}>
                  <Shuffle />
                  随机一位
                </Button>
              }
            />
            <div className="flex flex-wrap items-center gap-2">
              {(["general", "custom"] as const).map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={source === value ? "default" : "outline"}
                  onClick={() => {
                    setSource(value);
                    setProfession("全部职业");
                  }}
                >
                  {value === "general" ? "通用虚拟人像" : "自建虚拟人像"}
                </Button>
              ))}
              {["全部", "女", "男"].map((item) => (
                <Button
                  key={item}
                  size="sm"
                  variant={gender === item ? "default" : "outline"}
                  onClick={() => setGender(item)}
                >
                  {item}
                </Button>
              ))}
              <NativeSelect className="h-8" value={age} onChange={(event) => setAge(event.target.value)}>
                <option>全部年龄</option>
                <option>18–29 岁</option>
                <option>30–49 岁</option>
                <option>50 岁以上</option>
              </NativeSelect>
              <NativeSelect className="h-8" value={profession} onChange={(event) => setProfession(event.target.value)}>
                {professions.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </NativeSelect>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setQuery("");
                  setGender("全部");
                  setAge("全部年龄");
                  setProfession("全部职业");
                }}
              >
                重置
              </Button>
            </div>
          </div>
        }
      >
        <div ref={viewport} className="portrait-viewport">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((row) => (
              <div
                key={row.key}
                className="portrait-row"
                style={{
                  transform: `translateY(${row.start}px)`,
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}
              >
                {filtered.slice(row.index * columns, row.index * columns + columns).map((item) => (
                  <button type="button" className="portrait-card" key={item.key} onClick={() => setSelected(item)}>
                    <div className="portrait-image">
                      <MediaPreview
                        url={item.display_url}
                        mimeType="image/jpeg"
                        alt={item.name}
                        imageLoading="lazy"
                        authenticated={item.type === "custom"}
                        previewable={false}
                      />
                      <span>{item.type === "general" ? `NO. ${String(item.index).padStart(4, "0")}` : "自建"}</span>
                      <i>{item.status === "active" ? "选择人像" : "处理中"}</i>
                    </div>
                    <div className="portrait-copy">
                      <h3>{item.profession}</h3>
                      <p>
                        {item.type === "general"
                          ? `${item.age} 岁 · ${item.gender}性 · 第 ${item.page} 页`
                          : item.status === "active"
                            ? "可用于创作"
                            : item.status === "failed"
                              ? "创建失败"
                              : "Ark 处理中"}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
          {isLoading && (
            <div className="portrait-loading">
              <Images />
              正在加载 1,125 份人像档案…
            </div>
          )}
        </div>
      </AssetPageShell>
      <ToolCreatorModal open={Boolean(selected)} title={selected?.name ?? "人像详情"} onClose={() => setSelected(null)}>
        {selected && (
          <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-4 sm:grid-cols-[180px_minmax(0,1fr)]">
            <div className="detail-photo">
              <MediaPreview
                url={selected.display_url}
                mimeType="image/jpeg"
                alt={selected.name}
                authenticated={selected.type === "custom"}
              />
              <span>
                {selected.status === "active" ? <Check /> : <LoaderCircle className="animate-spin" />}
                {selected.status === "active" ? "可用于创作" : selected.status === "failed" ? "创建失败" : "处理中"}
              </span>
            </div>
            <div className="detail-info">
              <div className="detail-tags">
                {selected.age > 0 && <span>{selected.age} 岁</span>}
                {selected.gender !== "未知" && <span>{selected.gender}性</span>}
                <span>{selected.profession}</span>
              </div>
              <p>{selected.description}</p>
              <dl>
                <div>
                  <dt>来源</dt>
                  <dd>{selected.type === "general" ? `通用虚拟人像 · 第 ${selected.page} 页` : "自建虚拟人像"}</dd>
                </div>
                <div>
                  <dt>资产编号</dt>
                  <dd>
                    {selected.type === "general" ? `XY-${String(selected.index).padStart(4, "0")}` : selected.assetId}
                  </dd>
                </div>
              </dl>
              <div className="detail-actions">
                <Button size="sm" disabled={selected.status !== "active"} onClick={useForCreation}>
                  <UserRound />
                  用于创作
                </Button>
                {selected.type === "general" && (
                  <a
                    className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-xs font-medium text-ink hover:bg-surface-muted"
                    href={selected.source_url}
                    download
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Download />
                    下载原图
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </ToolCreatorModal>
      <ToolCreatorModal open={createOpen} title="新建自建虚拟人像" onClose={() => !creating && setCreateOpen(false)}>
        <form
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!portraitFile || !portraitName.trim() || !portraitGender || creating) return;
            setCreating(true);
            setCreateError("");
            void createCustomPortrait(portraitFile, portraitName.trim(), portraitGender, portraitDescription.trim())
              .then(async () => {
                await queryClient.invalidateQueries({ queryKey: ["portrait-library"] });
                setSource("custom");
                setPortraitFile(null);
                setPortraitName("");
                setPortraitGender("");
                setPortraitDescription("");
                setCreateOpen(false);
              })
              .catch((error) => setCreateError(error instanceof Error ? error.message : "自建虚拟人像创建失败"))
              .finally(() => setCreating(false));
          }}
        >
          <label className="grid gap-1 text-xs text-muted" htmlFor="custom-portrait-file">
            人像图片
            <Input
              id="custom-portrait-file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={creating}
              onChange={(event) => setPortraitFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted" htmlFor="custom-portrait-name">
            人像名称
            <Input
              id="custom-portrait-name"
              value={portraitName}
              maxLength={80}
              disabled={creating}
              onChange={(event) => setPortraitName(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted" htmlFor="custom-portrait-gender">
            性别
            <NativeSelect
              id="custom-portrait-gender"
              className="h-9"
              value={portraitGender}
              disabled={creating}
              onChange={(event) => setPortraitGender(event.target.value as PortraitGender | "")}
            >
              <option value="" disabled>
                请选择性别
              </option>
              <option value="男">男</option>
              <option value="女">女</option>
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-xs text-muted" htmlFor="custom-portrait-description">
            基础描述
            <textarea
              id="custom-portrait-description"
              className="min-h-24 resize-y rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-ink"
              value={portraitDescription}
              maxLength={300}
              disabled={creating}
              onChange={(event) => setPortraitDescription(event.target.value)}
            />
          </label>
          {createError && <p className="text-xs text-danger">{createError}</p>}
          <div className="mt-auto flex justify-end gap-2 border-t border-line pt-3">
            <Button type="button" size="sm" variant="outline" disabled={creating} onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!portraitFile || !portraitName.trim() || !portraitGender || creating}
            >
              {creating && <LoaderCircle className="animate-spin" />}
              创建
            </Button>
          </div>
        </form>
      </ToolCreatorModal>
    </>
  );
}
