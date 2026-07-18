import {
  ArrowUp,
  CalendarDays,
  Check,
  ChevronDown,
  Download,
  Expand,
  FileAudio,
  FileImage,
  FileVideo,
  Grid2X2,
  Heart,
  Image,
  MessageSquarePlus,
  Plus,
  Search,
  Shrink,
  Sparkles,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AiGenerateMockStore,
  type GenerateKind,
  type GenerateModel,
  type GenerateResult,
  imageModels,
  videoModels,
} from "./ai-generate-mock";
import "./ai-generate.css";

type Panel = "kind" | "model" | "reference" | "format" | "count" | undefined;
const kindLabel: Record<GenerateKind, string> = { video: "视频生成", image: "图片生成" };
function ResultCard({
  result,
  store,
  onNotice,
  onPreview,
}: {
  result: GenerateResult;
  store: AiGenerateMockStore;
  onNotice: (value: string) => void;
  onPreview: (result: GenerateResult) => void;
}) {
  const download = () => {
    const blob = new Blob([JSON.stringify({ mock: true, ...result }, null, 2)], { type: "application/json" }),
      url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `ai-generate-${result.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    onNotice("Mock 结果已下载");
  };
  return (
    <article className={`ag-result ${result.status}`}>
      <div className="ag-result-preview">
        {result.kind === "video" ? <Video /> : <Image />}
        <span>
          {result.status === "generating"
            ? `Mock 生成中 ${result.progress}%`
            : result.status === "interrupted"
              ? "生成已中止"
              : "Mock 作品"}
        </span>
        {result.status === "generating" && (
          <i>
            <b style={{ width: `${result.progress}%` }} />
          </i>
        )}
      </div>
      <div className="ag-result-copy">
        <small>
          {result.model} · {new Date(result.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </small>
        <h3>{result.title}</h3>
        <p>{result.prompt}</p>
        {result.references.length > 0 && <div className="ag-result-refs">参考：{result.references.join("、")}</div>}
        <footer>
          <button onClick={() => onPreview(result)}>查看结果</button>
          <button onClick={() => store.continueFrom(result.id)}>继续追问</button>
          <button onClick={() => store.createVariant(result.id)}>创建变体</button>
          <button
            aria-label={result.favorite ? "取消收藏" : "收藏作品"}
            className={result.favorite ? "favorite" : ""}
            onClick={() => store.toggleFavorite(result.id)}
          >
            <Heart />
          </button>
          <button aria-label="下载" onClick={download}>
            <Download />
          </button>
        </footer>
      </div>
    </article>
  );
}
function ModelPanel({
  kind,
  value,
  onChange,
}: {
  kind: GenerateKind;
  value: GenerateModel;
  onChange: (model: GenerateModel) => void;
}) {
  const options = kind === "video" ? videoModels : imageModels;
  return (
    <div className="ag-popover ag-model-panel" role="dialog" aria-label="选择生成模型">
      <h3>选择模型</h3>
      {options.map((item) => (
        <button key={item.id} onClick={() => onChange(item.id)}>
          <span>
            <b>
              {item.name}
              {"badge" in item && item.badge && <em>{item.badge}</em>}
            </b>
            <small>{item.description}</small>
          </span>
          {value === item.id && <Check />}
        </button>
      ))}
      <div className="ag-model-note">
        <Sparkles />
        所有模型仅用于浏览器 Mock，不会调用付费接口。
      </div>
    </div>
  );
}

export function AiGeneratePage() {
  const [store] = useState(() => new AiGenerateMockStore()),
    snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot),
    [panel, setPanel] = useState<Panel>(),
    [confirming, setConfirming] = useState(false),
    [preview, setPreview] = useState<GenerateResult>(),
    [notice, setNotice] = useState(""),
    [query, setQuery] = useState(""),
    [kindFilter, setKindFilter] = useState<"all" | GenerateKind>("all"),
    [favoriteOnly, setFavoriteOnly] = useState(false),
    fileRef = useRef<HTMLInputElement>(null),
    inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    return () => store.dispose();
  }, [store]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 1800);
    return () => clearTimeout(timer);
  }, [notice]);
  const active = snapshot.conversations.find((item) => item.id === snapshot.activeId)!,
    results = useMemo(
      () =>
        active.results.filter(
          (result) =>
            (kindFilter === "all" || result.kind === kindFilter) &&
            (!favoriteOnly || result.favorite) &&
            (!query || result.title.toLowerCase().includes(query.toLowerCase())),
        ),
      [active.results, kindFilter, favoriteOnly, query],
    );
  const chooseFiles = (files: File[]) => {
      const error = store.addFiles(files);
      if (error) setNotice(error);
      if (fileRef.current) fileRef.current.value = "";
    },
    requestSubmit = () => {
      if (!snapshot.prompt.trim()) {
        setNotice("请输入创作内容");
        inputRef.current?.focus();
        return;
      }
      if (snapshot.manualConfirm) setConfirming(true);
      else store.submit();
    },
    confirm = () => {
      setConfirming(false);
      store.submit();
      setNotice("Mock 任务已提交");
    };
  return (
    <div
      className="ag-page"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setPanel(undefined);
      }}
    >
      <aside className="ag-conversations">
        <button className="ag-new" onClick={() => store.newConversation()}>
          <MessageSquarePlus />
          新对话
        </button>
        {snapshot.conversations.map((item) => (
          <button
            key={item.id}
            className="ag-conversation"
            aria-current={item.id === snapshot.activeId ? "true" : undefined}
            onClick={() => store.selectConversation(item.id)}
          >
            {item.title}
          </button>
        ))}
      </aside>
      <main className="ag-main">
        <div className="ag-filters">
          <label>
            <Search />
            <input
              aria-label="搜索作品"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索"
            />
          </label>
          <select
            aria-label="作品类型"
            value={kindFilter}
            onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}
          >
            <option value="all">全部类型</option>
            <option value="video">视频</option>
            <option value="image">图片</option>
          </select>
          <button>
            <CalendarDays />
            日期范围
          </button>
          <button className={favoriteOnly ? "active" : ""} onClick={() => setFavoriteOnly((value) => !value)}>
            <Heart />
            收藏
          </button>
        </div>
        <section className={`ag-thread ${results.length ? "has-results" : ""}`}>
          {results.map((result) => (
            <ResultCard key={result.id} result={result} store={store} onNotice={setNotice} onPreview={setPreview} />
          ))}
        </section>
        <section className={`ag-composer ${snapshot.expanded ? "expanded" : ""} ${results.length ? "docked" : ""}`}>
          <div className="ag-reference-row">
            <input
              ref={fileRef}
              hidden
              type="file"
              multiple
              accept="image/*,video/*,audio/*"
              onChange={(event) => chooseFiles(Array.from(event.target.files ?? []))}
            />
            <button className="ag-add-reference" aria-label="添加参考素材" onClick={() => fileRef.current?.click()}>
              <Plus />
              <span>参考</span>
            </button>
            {snapshot.references.map((ref) => (
              <div className="ag-reference" key={ref.id}>
                {ref.kind === "image" ? <FileImage /> : ref.kind === "video" ? <FileVideo /> : <FileAudio />}
                <span>
                  <b>{ref.name}</b>
                  <small>{ref.kind}</small>
                </span>
                <button aria-label={`移除 ${ref.name}`} onClick={() => store.removeReference(ref.id)}>
                  <Trash2 />
                </button>
              </div>
            ))}
          </div>
          <textarea
            ref={inputRef}
            aria-label="创作指令"
            placeholder="使用 @快速调用参考内容，例如：@图片1模仿 @视频1的动作，音色参考 @音频1"
            value={snapshot.prompt}
            onChange={(event) => store.setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                requestSubmit();
              }
            }}
          />
          <button
            className="ag-expand"
            aria-label={snapshot.expanded ? "收起输入框" : "展开输入框"}
            onClick={() => store.setExpanded(!snapshot.expanded)}
          >
            {snapshot.expanded ? <Shrink /> : <Expand />}
          </button>
          <div className="ag-parameters">
            <div>
              <button onClick={() => setPanel(panel === "kind" ? undefined : "kind")}>
                {snapshot.kind === "video" ? <Video /> : <Image />}
                {kindLabel[snapshot.kind]}
                <ChevronDown />
              </button>
              <button onClick={() => setPanel(panel === "model" ? undefined : "model")}>
                <Grid2X2 />
                {
                  (snapshot.kind === "video" ? videoModels : imageModels).find((item) => item.id === snapshot.model)
                    ?.name
                }
                <ChevronDown />
              </button>
              {snapshot.kind === "video" && (
                <button onClick={() => setPanel(panel === "reference" ? undefined : "reference")}>
                  <Grid2X2 />
                  全能参考
                  <ChevronDown />
                </button>
              )}
              <button onClick={() => setPanel(panel === "format" ? undefined : "format")}>
                {snapshot.ratio}
                <i /> {snapshot.resolution}
              </button>
              <button onClick={() => setPanel(panel === "count" ? undefined : "count")}>
                {snapshot.kind === "video"
                  ? `${snapshot.duration}s`
                  : snapshot.seed
                    ? `种子 ${snapshot.seed}`
                    : "随机种子"}
                <i />
                {snapshot.count}个
              </button>
            </div>
            <button className="ag-send" aria-label="提交生成" onClick={requestSubmit}>
              <ArrowUp />
            </button>
          </div>
          {panel === "kind" && (
            <div className="ag-popover ag-kind-panel">
              <button
                onClick={() => {
                  store.setKind("video");
                  setPanel(undefined);
                }}
              >
                <Video />
                视频生成{snapshot.kind === "video" && <Check />}
              </button>
              <button
                onClick={() => {
                  store.setKind("image");
                  setPanel(undefined);
                }}
              >
                <Image />
                图片生成{snapshot.kind === "image" && <Check />}
              </button>
            </div>
          )}
          {panel === "model" && (
            <ModelPanel
              kind={snapshot.kind}
              value={snapshot.model}
              onChange={(model) => {
                store.setModel(model);
                setPanel(undefined);
              }}
            />
          )}
          {panel === "reference" && (
            <div className="ag-popover ag-reference-panel">
              <b>全能参考</b>
              <small>支持图片、视频、音频各 1 个，综合控制主体、动作与音色。</small>
            </div>
          )}
          {panel === "format" && (
            <div className="ag-popover ag-format-panel">
              <h3>画面参数</h3>
              <div>
                {["9:16", "16:9", "1:1"].map((value) => (
                  <button
                    className={snapshot.ratio === value ? "active" : ""}
                    onClick={() => store.setRatio(value)}
                    key={value}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <div>
                {(snapshot.kind === "video" ? ["480P", "720P"] : ["1K", "2K"]).map((value) => (
                  <button
                    className={snapshot.resolution === value ? "active" : ""}
                    onClick={() => store.setResolution(value)}
                    key={value}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          )}
          {panel === "count" && (
            <div className="ag-popover ag-count-panel">
              <h3>生成数量</h3>
              <div>
                {[1, 2, 4].map((value) => (
                  <button
                    className={snapshot.count === value ? "active" : ""}
                    onClick={() => store.setCount(value)}
                    key={value}
                  >
                    {value}个
                  </button>
                ))}
              </div>
              {snapshot.kind === "video" ? (
                <>
                  <h3>视频时长</h3>
                  <div>
                    {[5, 10].map((value) => (
                      <button
                        className={snapshot.duration === value ? "active" : ""}
                        onClick={() => store.setDuration(value)}
                        key={value}
                      >
                        {value}s
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <label>
                  随机种子
                  <input
                    value={snapshot.seed}
                    onChange={(event) => store.setSeed(event.target.value.replace(/\D/g, "").slice(0, 10))}
                    placeholder="留空则随机"
                  />
                </label>
              )}
            </div>
          )}
        </section>
        <label className={`ag-manual-confirm ${results.length ? "docked" : ""}`}>
          <input
            type="checkbox"
            checked={snapshot.manualConfirm}
            onChange={(event) => store.setManualConfirm(event.target.checked)}
          />
          提交前手动确认
        </label>
      </main>
      {preview && (
        <div className="ag-confirm-mask ag-preview-mask" onMouseDown={() => setPreview(undefined)}>
          <section role="dialog" aria-label="Mock 结果预览" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <h2>Mock 结果预览</h2>
              <button aria-label="关闭" onClick={() => setPreview(undefined)}>
                <X />
              </button>
            </header>
            <div className="ag-preview-art">
              {preview.kind === "video" ? <Video /> : <Image />}
              <b>{preview.title}</b>
              <span>{preview.ratio}</span>
            </div>
            <p>{preview.prompt}</p>
          </section>
        </div>
      )}
      {confirming && (
        <div className="ag-confirm-mask" onMouseDown={() => setConfirming(false)}>
          <section role="dialog" aria-label="确认提交生成" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <h2>确认提交生成</h2>
              <button aria-label="关闭" onClick={() => setConfirming(false)}>
                <X />
              </button>
            </header>
            <dl>
              <div>
                <dt>生成类型</dt>
                <dd>{kindLabel[snapshot.kind]}</dd>
              </div>
              <div>
                <dt>模型</dt>
                <dd>
                  {
                    (snapshot.kind === "video" ? videoModels : imageModels).find((item) => item.id === snapshot.model)
                      ?.name
                  }
                </dd>
              </div>
              <div>
                <dt>画面</dt>
                <dd>
                  {snapshot.ratio} · {snapshot.resolution}
                </dd>
              </div>
              <div>
                <dt>数量</dt>
                <dd>{snapshot.count} 个</dd>
              </div>
            </dl>
            <p>{snapshot.prompt}</p>
            <footer>
              <button onClick={() => setConfirming(false)}>返回修改</button>
              <button className="primary" onClick={confirm}>
                确认提交 Mock
              </button>
            </footer>
          </section>
        </div>
      )}
      {notice && (
        <button className="ag-toast" onClick={() => setNotice("")}>
          {notice}
          <X />
        </button>
      )}
    </div>
  );
}
