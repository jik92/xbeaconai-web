// biome-ignore-all lint/a11y/useButtonType: This full-screen workbench contains no forms.
// biome-ignore-all lint/a11y/noStaticElementInteractions: Modal backdrops dismiss their dialogs.
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  Copy,
  Download,
  FileText,
  History,
  LoaderCircle,
  Mic2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Upload,
  UserRound,
  Video,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  downloadAuthenticated,
  fetchJob,
  fetchLibraryAssets,
  fetchProducts,
  generateRemixProject,
} from "@/api/api-client";
import type { Job } from "@/api/generated/types.gen";
import { AttachmentPicker, type AttachmentSelection } from "@/components/domain/attachment-picker";
import { AuthenticatedMedia } from "@/components/domain/authenticated-media";
import type { ApiJobResult, LibraryAsset, LibraryProduct } from "@/entities/types";
import { fetchPortraits, type Portrait } from "@/features/portrait-library/portrait-data";
import "./remix-project.css";

const stages = ["上传配置", "AI 解析", "提示词校对", "分镜校对", "合并成片"];
const demoProduct = "古叔的着 巴拿马草帽男夏季大头围新款船夫帽休闲复古平顶草编帽_07171549";
const fallbackPortrait =
  "https://omni-agent.tos-cn-beijing.volces.com/resource/virtual-person/asset-20260224201926-kq66z.png";

interface SelectedPortrait {
  name: string;
  profession: string;
  source_url: string;
  index: number;
  description?: string;
  gender?: string;
  age?: number;
}

function WorkflowHeader({
  stage,
  onStage,
  onHistory,
  onReset,
}: {
  stage: number;
  onStage: (stage: number) => void;
  onHistory: () => void;
  onReset: () => void;
}) {
  return (
    <header className="remix-header">
      <div className="remix-brand">
        <Video />
        爆款二创
      </div>
      <nav className="remix-steps" aria-label="创作进度">
        {stages.map((label, index) => (
          <button
            key={label}
            className={index === stage ? "active" : index < stage ? "done" : ""}
            onClick={() => index <= stage && onStage(index)}
          >
            <i>{index < stage ? <Check /> : index + 1}</i>
            <span>{label}</span>
            {index < stages.length - 1 && <ChevronRight className="step-arrow" />}
          </button>
        ))}
      </nav>
      <div className="remix-header-actions">
        <button onClick={onHistory}>
          <History />
          项目记录
        </button>
        <button onClick={onReset}>
          <Plus />
          新建
        </button>
      </div>
    </header>
  );
}

function ConfigSidebar({
  mode,
  setMode,
  description,
  setDescription,
  projectName,
  setProjectName,
  selectedPortrait,
  selectedProduct,
  selectedVoice,
  source,
  onSelectAttachment,
  onPick,
}: {
  mode: "product" | "talking";
  setMode: (mode: "product" | "talking") => void;
  description: string;
  setDescription: (value: string) => void;
  projectName: string;
  setProjectName: (value: string) => void;
  selectedPortrait: SelectedPortrait | null;
  selectedProduct: LibraryProduct | null;
  selectedVoice: LibraryAsset | null;
  source: string;
  onSelectAttachment: (asset: AttachmentSelection) => void;
  onPick: (kind: "product" | "portrait" | "voice") => void;
}) {
  const fileName = source ? source.split(":").slice(2).join(":") : "";
  return (
    <aside className="remix-config">
      <div className="remix-mode-tabs">
        <button className={mode === "product" ? "active" : ""} onClick={() => setMode("product")}>
          含商品模式
        </button>
        <button className={mode === "talking" ? "active" : ""} onClick={() => setMode("talking")}>
          纯口播模式
        </button>
      </div>
      <input
        className="remix-project-name"
        aria-label="项目名称"
        maxLength={30}
        placeholder="项目名称（选填）"
        value={projectName}
        onChange={(event) => setProjectName(event.target.value)}
      />
      <div className="config-field-title">
        <b>
          商品 <em>*</em>
        </b>
        <button onClick={() => onPick("product")}>⚙ 商品库</button>
      </div>
      <button className="config-product" onClick={() => onPick("product")}>
        {selectedProduct ? (
          <span className="product-thumb product-asset-thumb">
            <AuthenticatedMedia
              url={selectedProduct.images[0]?.url || ""}
              mimeType={selectedProduct.images[0]?.mimeType || "image/png"}
              alt={selectedProduct.name}
            />
          </span>
        ) : (
          <span className="product-thumb" />
        )}
        <span>{selectedProduct?.name || "未选择商品"}</span>
        <b>{selectedProduct ? "更换" : "选择"}</b>
      </button>
      <div className="config-field-title">
        <b>人像</b>
        <button onClick={() => onPick("portrait")}>{selectedPortrait ? "更换" : "+ 添加"}</button>
      </div>
      {selectedPortrait ? (
        <img className="config-portrait" src={selectedPortrait?.source_url || fallbackPortrait} alt="已选人像" />
      ) : (
        <span className="config-empty">未添加人像</span>
      )}
      <div className="config-field-title">
        <b>口播音色</b>
        <button onClick={() => onPick("voice")}>{selectedVoice ? "更换" : "+ 选择"}</button>
      </div>
      <button className="config-voice" onClick={() => onPick("voice")}>
        <Mic2 />
        <span>
          <b>{selectedVoice?.name || "未选择音色"}</b>
          <small>{selectedVoice?.description || "使用视频原声或从音色库选择"}</small>
        </span>
      </button>
      <label className="config-description">
        需求描述
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="描述商品卖点、目标人群、风格基调…"
        />
      </label>
      <div className="config-field-title video-title">
        <b>
          分镜视频 <em>*</em>
        </b>
        <small>（同一成片的连续片段）</small>
      </div>
      <AttachmentPicker
        accept="video/*"
        trigger={(open) =>
          source ? (
            <button type="button" className="uploaded-video-card" onClick={open}>
              <span className="video-card-thumb">
                <Video />
              </span>
              <span>
                <b>{fileName}</b>
                <small>点击可从素材库或本地重新选择</small>
                <small>解析模版：未设置</small>
                <small>思考深度：深度</small>
              </span>
            </button>
          ) : (
            <button type="button" className="config-attachment-picker" onClick={open}>
              <Upload />
              <span>
                <b>选择分镜视频</b>
                <small>从素材库选择或从本地上传</small>
              </span>
            </button>
          )
        }
        onSelect={([asset]) => asset && onSelectAttachment(asset)}
      />
    </aside>
  );
}

function AssetPickerModal({
  kind,
  onClose,
  onSelect,
}: {
  kind: "product" | "voice";
  onClose: () => void;
  onSelect: (asset: LibraryAsset) => void;
}) {
  const {
    data = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["asset-library", kind],
    queryFn: () => (kind === "voice" ? fetchLibraryAssets("voice") : Promise.resolve([])),
  });
  const title = kind === "product" ? "选择商品" : "选择口播音色";
  return (
    <div className="remix-picker-layer" role="presentation" onMouseDown={onClose}>
      <aside className="remix-picker" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <small>ASSET LIBRARY</small>
            <h2>{title}</h2>
          </div>
          <button aria-label="关闭" onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="remix-picker-grid">
          {data.map((asset) => (
            <button key={asset.id} onClick={() => onSelect(asset)}>
              <span className={kind}>
                {kind === "product" ? (
                  <AuthenticatedMedia url={asset.url} mimeType={asset.mimeType} alt={asset.name} />
                ) : (
                  <Mic2 />
                )}
              </span>
              <b>{asset.name}</b>
              <small>{asset.description || asset.originalName}</small>
            </button>
          ))}
          {isLoading && <p>正在加载资产…</p>}
          {error && <p>{error instanceof Error ? error.message : "资产加载失败"}</p>}
          {!isLoading && !error && !data.length && (
            <p>资产库还是空的，请先上传一个{kind === "product" ? "商品" : "音色"}。</p>
          )}
        </div>
        <footer>
          <button onClick={() => window.location.assign(kind === "product" ? "/assets/products" : "/assets/voices")}>
            <Upload />
            管理并上传{kind === "product" ? "商品" : "音色"}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function ProductPickerModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (product: LibraryProduct) => void;
}) {
  const {
    data = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["product-library"],
    queryFn: fetchProducts,
  });
  return (
    <div className="remix-picker-layer" role="presentation" onMouseDown={onClose}>
      <aside className="remix-picker" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <small>PRODUCT LIBRARY</small>
            <h2>选择商品</h2>
          </div>
          <button aria-label="关闭" onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="remix-picker-grid">
          {data.map((product) => (
            <button key={product.id} onClick={() => onSelect(product)}>
              <span className="product">
                <AuthenticatedMedia
                  url={product.images[0]?.url || ""}
                  mimeType={product.images[0]?.mimeType || "image/png"}
                  alt={product.name}
                />
              </span>
              <b>{product.name}</b>
              <small>
                {product.images.length} 张商品图 · {product.description || "暂无形态描述"}
              </small>
            </button>
          ))}
          {isLoading && <p>正在加载商品…</p>}
          {error && <p>{error instanceof Error ? error.message : "商品加载失败"}</p>}
          {!isLoading && !error && !data.length && <p>商品库还是空的，请先创建商品并上传图片。</p>}
        </div>
        <footer>
          <button onClick={() => window.location.assign("/assets/products")}>
            <Upload />
            管理并上传商品
          </button>
        </footer>
      </aside>
    </div>
  );
}

function PortraitPickerModal({
  selected,
  onClose,
  onSelect,
}: {
  selected: SelectedPortrait | null;
  onClose: () => void;
  onSelect: (portrait: Portrait) => void;
}) {
  const {
    data = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["portrait-library"],
    queryFn: fetchPortraits,
    staleTime: Infinity,
  });
  const [query, setQuery] = useState("");
  const [gender, setGender] = useState("全部");
  const [visibleCount, setVisibleCount] = useState(48);
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return data.filter((portrait) => {
      const matchesQuery =
        !normalizedQuery ||
        `${portrait.name} ${portrait.profession} ${portrait.description}`.toLowerCase().includes(normalizedQuery);
      return matchesQuery && (gender === "全部" || portrait.gender === gender);
    });
  }, [data, gender, query]);

  useEffect(() => setVisibleCount(48), [gender, query]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="remix-picker-layer" role="presentation" onMouseDown={onClose}>
      <aside
        className="remix-picker portrait-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-label="选择人像"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <small>PORTRAIT LIBRARY</small>
            <h2>选择人像</h2>
          </div>
          <button aria-label="关闭" onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="portrait-picker-controls">
          <label>
            <Search />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索职业、年龄或人物描述…"
            />
          </label>
          <div aria-label="按性别筛选">
            {["全部", "女", "男"].map((item) => (
              <button key={item} className={gender === item ? "active" : ""} onClick={() => setGender(item)}>
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="remix-picker-grid portrait-picker-grid">
          {filtered.slice(0, visibleCount).map((portrait) => {
            const isCurrent = selected?.index === portrait.index;
            return (
              <button
                key={portrait.index}
                className={isCurrent ? "current" : ""}
                aria-label={`${isCurrent ? "当前人像，" : ""}选择${portrait.name}`}
                onClick={() => onSelect(portrait)}
              >
                <span className="portrait">
                  <img src={portrait.source_url} alt={portrait.name} loading="lazy" />
                  {isCurrent && (
                    <i>
                      <CircleCheck /> 当前使用
                    </i>
                  )}
                </span>
                <b>{portrait.profession}</b>
                <small>
                  {portrait.age ? `${portrait.age} 岁 · ` : ""}
                  {portrait.gender}性 · NO. {String(portrait.index).padStart(4, "0")}
                </small>
              </button>
            );
          })}
          {isLoading && <p>正在加载人像库…</p>}
          {error && <p>{error instanceof Error ? error.message : "人像清单加载失败"}</p>}
          {!isLoading && !error && !filtered.length && <p>没有找到匹配的人像，请调整搜索条件。</p>}
        </div>
        <footer className="portrait-picker-footer">
          <span>
            共 {filtered.length.toLocaleString()} 个人像
            {filtered.length > visibleCount && `，已显示 ${visibleCount} 个`}
          </span>
          <div>
            {filtered.length > visibleCount && (
              <button onClick={() => setVisibleCount((count) => count + 48)}>加载更多</button>
            )}
            <button onClick={onClose}>取消</button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function ProjectHistoryDrawer({ open, job, onClose }: { open: boolean; job: Job | null; onClose: () => void }) {
  const rows = useMemo(
    () => [
      {
        name: demoProduct,
        product: demoProduct,
        progress: "分镜校对 1 / 1",
        tone: "orange",
        time: "2026-07-17\n17:00:12",
      },
      {
        name: "潮流男士胸包百搭休闲男士腰包时尚…",
        product: "潮流男士胸包百搭休闲男士腰包时尚",
        progress: "分镜校对 2 / 3",
        tone: "orange",
        time: "2026-07-17\n14:37:22",
      },
      {
        name: "夏季新款高腰窄版直筒女裤垂顺显瘦透…",
        product: "夏季新款高腰窄版直筒女裤垂顺显瘦透…",
        progress: "提示词校对",
        tone: "blue",
        time: "2026-07-16\n17:06:30",
      },
      {
        name: "夏季新款高腰窄版直筒女裤垂顺显瘦透…",
        product: "夏季新款高腰窄版直筒女裤垂顺显瘦透…",
        progress: "分镜校对 1 / 1",
        tone: "orange",
        time: "2026-07-16\n17:06:25",
      },
    ],
    [],
  );
  if (!open) return null;
  return (
    <div className="history-layer" role="presentation" onMouseDown={onClose}>
      <aside
        className="history-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="项目记录"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <button aria-label="关闭" onClick={onClose}>
            <X />
          </button>
          <h2>项目记录</h2>
        </header>
        <div className="history-filters">
          <label>
            <input placeholder="搜索项目名称" />
            <Search />
          </label>
          <button>
            项目进度 <ChevronDown />
          </button>
          <button className="history-search">查询</button>
        </div>
        <div className="history-table">
          <div className="history-head">
            <span>项目名称</span>
            <span>项目进度</span>
            <span>创建人</span>
            <span>更新时间</span>
            <span>操作</span>
          </div>
          {rows.map((row, index) => (
            <div className="history-row" key={row.time}>
              <span>
                <b>
                  {index === 0 && job?.title ? job.title : row.name} <Pencil />
                </b>
                <small>产品：{row.product}</small>
              </span>
              <span>
                <i className={row.tone}>{row.progress}</i>
              </span>
              <span>尧子康</span>
              <span className="history-time">{row.time}</span>
              <span>
                <button>继续创作</button>
              </span>
            </div>
          ))}
        </div>
        <footer>
          <span>共 4 条</span>
          <button disabled>
            <ChevronLeft />
          </button>
          <b>1</b>
          <button disabled>
            <ChevronRight />
          </button>
        </footer>
      </aside>
    </div>
  );
}

export function RemixProject() {
  const [stage, setStage] = useState(0);
  const [parsed, setParsed] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [source, setSource] = useState("");
  const [mode, setMode] = useState<"product" | "talking">("product");
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [compare, setCompare] = useState(false);
  const [notice, setNotice] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [picker, setPicker] = useState<"product" | "portrait" | "voice" | null>(null);
  const [selectedPortrait, setSelectedPortrait] = useState<SelectedPortrait | null>(() => {
    try {
      return JSON.parse(localStorage.getItem("studio:selectedPortrait") || "null");
    } catch {
      return null;
    }
  });
  const [selectedProduct, setSelectedProduct] = useState<LibraryProduct | null>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("studio:selectedProduct") || "null") as
        | LibraryProduct
        | LibraryAsset
        | null;
      if (!stored) return null;
      if ("images" in stored) return stored;
      return {
        id: stored.id,
        name: stored.name,
        description: stored.description,
        sharingScope: "private",
        images: [stored],
        createdAt: stored.createdAt,
      };
    } catch {
      return null;
    }
  });
  const [selectedVoice, setSelectedVoice] = useState<LibraryAsset | null>(() => {
    try {
      return JSON.parse(localStorage.getItem("studio:selectedVoice") || "null");
    } catch {
      return null;
    }
  });
  const activeJobId = job && (job.status === "queued" || job.status === "processing") ? job.id : null;

  useEffect(() => {
    if (!activeJobId) return;
    const refresh = () => {
      void fetchJob(activeJobId)
        .then((updated) => {
          setJob(updated);
          const generatedPrompt =
            updated.values.analysisPrompt ||
            updated.result?.artifacts.find((artifact) => artifact.mimeType === "text/markdown" && artifact.text)?.text;
          if (generatedPrompt) setPrompt(generatedPrompt);
          if (updated.status === "failed") {
            setParsing(false);
            setNotice(updated.error?.message || "视频解析失败，请稍后重试");
            return;
          }
          if (updated.status === "succeeded" && generatedPrompt && !parsed) {
            setParsed(true);
            setParsing(false);
            setStage(2);
          }
        })
        .catch(() => setNotice("任务状态刷新失败，将在 10 秒后重试"));
    };
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => window.clearInterval(timer);
  }, [activeJobId, parsed]);

  const parse = async () => {
    if (parsing) return;
    if (!source || !selectedProduct) {
      setNotice(source ? "请先从商品库选择商品" : "请先上传分镜视频并选择商品");
      setStage(0);
      return;
    }
    setParsed(false);
    setParsing(true);
    setStage(1);
    setNotice("");
    try {
      const sourceAssetId = source.split(":", 3)[1];
      if (!sourceAssetId) throw new Error("视频素材标识无效，请重新上传");
      const videoName = source.split(":").slice(2).join(":");
      const videoUrl = `/api/assets/${sourceAssetId}/content`;
      const portraitAssetId = selectedPortrait?.source_url.match(/\/([^/]+)\.png(?:\?|$)/)?.[1] ?? null;
      const created = await generateRemixProject({
        projectName:
          projectName.trim() ||
          `爆款二创 · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        product: {
          id: selectedProduct.id,
          productName: selectedProduct.name,
          productImages: selectedProduct.images.map((image) => ({
            id: null,
            filename: image.originalName,
            objectKey: image.id,
            fileMd5: null,
            fileUrl: image.url,
            coverUrl: image.url,
            fileType: "IMAGE",
            metaId: image.id,
            assetId: null,
            duration: null,
            durationSec: null,
            arkVideoUrl: null,
            aiDescription: selectedProduct.description ?? null,
          })),
          productFormMetaList: null,
          productFormDesc: selectedProduct.description ?? null,
        },
        demand: description,
        rawMaterialFiles: [
          {
            filename: videoName,
            objectKey: sourceAssetId,
            fileMd5: null,
            fileUrl: videoUrl,
            coverUrl: videoUrl,
            fileType: "VIDEO",
            duration: null,
            reasoningEffort: "high",
          },
        ],
        portraitAssets: selectedPortrait
          ? [
              {
                id: selectedPortrait.index,
                assetName: selectedPortrait.name,
                fileInfo: [
                  {
                    fileUrl: selectedPortrait.source_url,
                    coverUrl: selectedPortrait.source_url,
                    fileType: "IMAGE",
                    assetId: portraitAssetId,
                  },
                ],
                description: selectedPortrait.description ?? "",
                gender: selectedPortrait.gender ?? "",
                age: selectedPortrait.age,
                occupation: selectedPortrait.profession,
              },
            ]
          : [],
      });
      setJob(created);
    } catch (error) {
      setParsing(false);
      setNotice(error instanceof Error ? error.message : "解析任务提交失败");
    }
  };
  const next = () => {
    if (stage === 0) {
      void parse();
      return;
    }
    if (stage === 1 && !parsed) return;
    setStage((value) => Math.min(4, value + 1));
  };
  const reset = () => {
    setStage(0);
    setParsed(false);
    setParsing(false);
    setEditing(false);
    setSource("");
    setProjectName("");
    setDescription("");
    setPrompt("");
    setJob(null);
    setNotice("");
  };
  const result = job?.result as ApiJobResult | undefined;
  const resultVideo = result?.artifacts.find((artifact) => artifact.mimeType.startsWith("video/") && artifact.url);
  const downloadResult = () => {
    if (!resultVideo?.url) {
      setNotice("结果文件仍在生成");
      return;
    }
    void downloadAuthenticated(resultVideo.url, resultVideo.name)
      .then(() => setNotice("已开始下载视频"))
      .catch(() => setNotice("下载失败，请稍后重试"));
  };
  const fileName = source ? source.split(":").slice(2).join(":") : "13428656243498662.mp4";

  return (
    <div className="remix-project">
      <WorkflowHeader stage={stage} onStage={setStage} onHistory={() => setHistoryOpen(true)} onReset={reset} />
      <div className="remix-body">
        <ConfigSidebar
          mode={mode}
          setMode={setMode}
          description={description}
          setDescription={setDescription}
          projectName={projectName}
          setProjectName={setProjectName}
          selectedPortrait={selectedPortrait}
          selectedProduct={selectedProduct}
          selectedVoice={selectedVoice}
          source={source}
          onSelectAttachment={(asset) => setSource(`asset:${asset.id}:${asset.name}`)}
          onPick={setPicker}
        />
        <section className="remix-workspace">
          {notice && (
            <button className="remix-toast" onClick={() => setNotice("")}>
              <Sparkles />
              {notice}
              <X />
            </button>
          )}
          {stage === 0 && (
            <div className="stage-empty">
              <Video />
              <b>填写左侧配置后开始</b>
              <p>
                选择商品、填写需求、上传分镜片段，点击「视频解析」
                <br />
                系统将创建项目并批量反解析每条分镜的提示词。
              </p>
            </div>
          )}
          {stage === 1 && (
            <div className="analysis-stage">
              <div className="analysis-orbit">{parsing ? <LoaderCircle className="animate-spin" /> : <Sparkles />}</div>
              <h2>{parsing ? "AI 正在解析分镜视频" : "等待开始 AI 解析"}</h2>
              <p>正在识别人物、商品、场景、镜头边界和口播文案</p>
              <div className="analysis-progress">
                <span style={{ width: `${job?.progress ?? (parsing ? 16 : 0)}%` }} />
                <b>{job?.stage ?? "准备解析任务…"}</b>
              </div>
            </div>
          )}
          {stage >= 2 && (
            <div className="source-strip">
              <button className="active">
                <span className="source-mini">
                  <Video />
                </span>
                <b>{fileName}</b>
                <i>v1</i>
              </button>
            </div>
          )}
          {stage === 2 && (
            <div className="prompt-stage">
              <div className="prompt-toolbar">
                <label>
                  对比版本{" "}
                  <button className={`toggle ${compare ? "active" : ""}`} onClick={() => setCompare(!compare)} />
                </label>
                <div>
                  <button onClick={() => setNotice("智能检查通过：结构完整，未发现冲突")}>
                    <CircleCheck />
                    智能检查
                  </button>
                  <button
                    className="purple"
                    onClick={() => {
                      setPrompt(`${prompt}\n\nAI 优化：强化前三秒冲突，提升口语表达。`);
                      setNotice("已完成智能修改");
                    }}
                  >
                    <Pencil />
                    智能修改
                  </button>
                  <button className="orange" onClick={() => setNotice("已切换口播音色")}>
                    <Mic2 />
                    换口播
                  </button>
                </div>
              </div>
              <div className="prompt-content">
                <aside>
                  <button className="active">
                    <b>v3</b>
                    <small>手动修改</small>
                    <Check />
                  </button>
                  <p>历史版本</p>
                  <button>
                    <b>v2</b>
                    <small>AI修改</small>
                    <Check />
                  </button>
                  <button>
                    <b>v1</b>
                    <small>AI解析</small>
                    <Check />
                  </button>
                </aside>
                <div className="prompt-document">
                  {editing ? (
                    <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
                  ) : (
                    <pre>{prompt}</pre>
                  )}
                </div>
              </div>
              <footer className="stage-actions">
                <div>
                  <button onClick={() => setEditing(!editing)}>
                    <FileText />
                    {editing ? "保存文本" : "编辑文本"}
                  </button>
                  <button
                    onClick={() => void navigator.clipboard.writeText(prompt).then(() => setNotice("脚本已复制"))}
                  >
                    <Copy />
                    复制脚本
                  </button>
                </div>
                <button className="primary" onClick={next}>
                  下一步
                </button>
              </footer>
            </div>
          )}
          {stage === 3 && (
            <div className="storyboard-proof">
              <article className="result-card">
                <header>
                  <b>
                    <Video />
                    结果预览 <i>v1</i>
                  </b>
                  <button>
                    <Clock3 />
                    版本历史（1）
                  </button>
                </header>
                <div className="result-main">
                  <div className="result-video">
                    {resultVideo?.url ? (
                      <AuthenticatedMedia
                        url={resultVideo.url}
                        mimeType={resultVideo.mimeType}
                        alt={resultVideo.name}
                      />
                    ) : (
                      <div className="warehouse-scene">
                        <UserRound />
                      </div>
                    )}
                  </div>
                  <div className="result-info">
                    <h3>字节Seedance 2.0</h3>
                    <p>
                      2026-07-17 16:39:28　成本：<em>1657星点</em>
                    </p>
                    <div className="result-assets">
                      <span />
                      <span />
                      <span />
                      <span />
                      <img src={selectedPortrait?.source_url || fallbackPortrait} alt="人像" />
                    </div>
                    <div className="result-meta">
                      <i>15秒</i>
                      <i>9:16</i>
                      <i>720p</i>
                      <i>Seed: 1175242905</i>
                    </div>
                    <b className="creative-title">创意描述</b>
                    <pre>{prompt}</pre>
                    <div className="result-actions">
                      <button onClick={() => setNotice("字幕已擦除")}>
                        <Pencil />
                        擦除字幕
                      </button>
                      <button onClick={() => setStage(2)}>
                        <Pencil />
                        重新编辑
                      </button>
                      <button onClick={downloadResult}>
                        <Download />
                        下载
                      </button>
                    </div>
                  </div>
                </div>
              </article>
              <article className="shot-prompt-row">
                <img src={selectedPortrait?.source_url || fallbackPortrait} alt="人物" />
                <button>
                  <Plus />
                </button>
                <pre>{prompt}</pre>
              </article>
            </div>
          )}
          {stage === 4 && (
            <div className="compose-stage">
              <div className="compose-top">
                <div>
                  <b>成片时间线</b>
                  <span>拖拽片段调整顺序</span>
                </div>
                <i>1/1 片段就绪</i>
              </div>
              <div className="timeline">
                <article>
                  <div className="warehouse-scene">
                    <UserRound />
                    <b>1</b>
                  </div>
                  <footer>
                    <span>{fileName.slice(0, 10)}…</span>
                    <i>就绪</i>
                  </footer>
                </article>
              </div>
              <article className="compose-preview">
                <header>
                  <b>
                    <Video />
                    成片预览
                  </b>
                </header>
                <div>
                  {resultVideo?.url ? (
                    <AuthenticatedMedia url={resultVideo.url} mimeType={resultVideo.mimeType} alt={resultVideo.name} />
                  ) : (
                    <>
                      <Video />
                      <p>点击下方「开始合并」生成成片</p>
                    </>
                  )}
                </div>
                <footer>
                  <button onClick={() => setStage(3)}>返回分镜</button>
                  <button
                    className="primary"
                    onClick={() => setNotice(job?.status === "succeeded" ? "成片已生成" : "已提交合并任务")}
                  >
                    <Video />
                    开始合并
                  </button>
                </footer>
              </article>
            </div>
          )}
        </section>
      </div>
      {stage === 0 && (
        <button className="parse-button" disabled={!source || !selectedProduct || parsing} onClick={() => void parse()}>
          <Sparkles />
          {parsing ? "解析中" : "视频解析"}
        </button>
      )}
      <ProjectHistoryDrawer open={historyOpen} job={job} onClose={() => setHistoryOpen(false)} />
      {picker === "product" && (
        <ProductPickerModal
          onClose={() => setPicker(null)}
          onSelect={(product) => {
            setSelectedProduct(product);
            localStorage.setItem("studio:selectedProduct", JSON.stringify(product));
            setPicker(null);
          }}
        />
      )}
      {picker === "voice" && (
        <AssetPickerModal
          kind="voice"
          onClose={() => setPicker(null)}
          onSelect={(asset) => {
            setSelectedVoice(asset);
            localStorage.setItem("studio:selectedVoice", JSON.stringify(asset));
            setPicker(null);
          }}
        />
      )}
      {picker === "portrait" && (
        <PortraitPickerModal
          selected={selectedPortrait}
          onClose={() => setPicker(null)}
          onSelect={(portrait) => {
            const selected = {
              name: portrait.name,
              profession: portrait.profession,
              source_url: portrait.source_url,
              index: portrait.index,
              description: portrait.description,
              gender: portrait.gender,
              age: portrait.age,
            };
            setSelectedPortrait(selected);
            localStorage.setItem("studio:selectedPortrait", JSON.stringify(selected));
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}
