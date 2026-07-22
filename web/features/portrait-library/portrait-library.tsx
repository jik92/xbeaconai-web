import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Download, Images, Shuffle, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AssetPageShell, AssetPageToolbar } from "@/components/domain/asset-page-shell";
import { ToolCreatorModal } from "@/components/domain/tool-creator-modal";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { fetchPortraits, type Portrait } from "./portrait-data";

const getPortraitColumns = () =>
  window.innerWidth > 1600 ? 6 : window.innerWidth > 1250 ? 5 : window.innerWidth > 800 ? 4 : 2;

export function PortraitLibrary() {
  const requestedPortraitId = Number(new URLSearchParams(window.location.search).get("portraitId"));
  const { data = [], isLoading } = useQuery({
    queryKey: ["portrait-library"],
    queryFn: fetchPortraits,
    staleTime: Infinity,
  });
  const [query, setQuery] = useState("");
  const [gender, setGender] = useState("全部");
  const [age, setAge] = useState("全部年龄");
  const [profession, setProfession] = useState("全部职业");
  const [selected, setSelected] = useState<Portrait | null>(null);
  const [columns, setColumns] = useState(getPortraitColumns);
  const viewport = useRef<HTMLDivElement>(null);
  const requestedPortraitLocated = useRef(false);
  useEffect(() => {
    if (!requestedPortraitId || requestedPortraitLocated.current) return;
    const portrait = data.find((item) => item.index === requestedPortraitId);
    if (portrait) {
      requestedPortraitLocated.current = true;
      setSelected(portrait);
    }
  }, [data, requestedPortraitId]);
  useEffect(() => {
    const resize = () => setColumns(getPortraitColumns());
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const professions = useMemo(
    () => [
      "全部职业",
      ...Array.from(new Set(data.map((item) => item.profession))).sort((a, b) => a.localeCompare(b, "zh-CN")),
    ],
    [data],
  );
  const filtered = useMemo(
    () =>
      data.filter((item) => {
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
    [age, data, gender, profession, query],
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
        index: selected.index,
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
              onAction={() => undefined}
              secondaryActions={
                <Button size="sm" variant="outline" onClick={random}>
                  <Shuffle />
                  随机一位
                </Button>
              }
            />
            <div className="flex flex-wrap items-center gap-2">
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
                  <button type="button" className="portrait-card" key={item.index} onClick={() => setSelected(item)}>
                    <div className="portrait-image">
                      <img src={item.source_url} alt={item.name} loading="lazy" />
                      <span>NO. {String(item.index).padStart(4, "0")}</span>
                      <i>选择人像</i>
                    </div>
                    <div className="portrait-copy">
                      <h3>{item.profession}</h3>
                      <p>
                        {item.age} 岁 · {item.gender}性 · 第 {item.page} 页
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
              <img src={selected.source_url} alt={selected.name} />
              <span>
                <Check />
                可用于创作
              </span>
            </div>
            <div className="detail-info">
              <div className="detail-tags">
                <span>{selected.age} 岁</span>
                <span>{selected.gender}性</span>
                <span>{selected.profession}</span>
              </div>
              <p>{selected.description}</p>
              <dl>
                <div>
                  <dt>来源页码</dt>
                  <dd>第 {selected.page} 页</dd>
                </div>
                <div>
                  <dt>资产编号</dt>
                  <dd>XY-{String(selected.index).padStart(4, "0")}</dd>
                </div>
              </dl>
              <div className="detail-actions">
                <Button size="sm" onClick={useForCreation}>
                  <UserRound />
                  用于创作
                </Button>
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
              </div>
            </div>
          </div>
        )}
      </ToolCreatorModal>
    </>
  );
}
