// biome-ignore-all lint/a11y/useButtonType: This full-screen workbench contains no forms.
// biome-ignore-all lint/a11y/noStaticElementInteractions: Modal backdrops dismiss their dialogs.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  Copy,
  Download,
  FileText,
  History,
  ImageOff,
  LoaderCircle,
  Mic2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Upload,
  Video,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  composeRemixVideos,
  downloadAuthenticated,
  fetchCreationCapabilities,
  fetchJob,
  fetchLibraryAssets,
  fetchProducts,
  fetchRemixProject,
  fetchRemixProjects,
  fetchRemixShotJobs,
  generateRemixProject,
  generateRemixShot,
  type RemixProjectDetail,
  type RemixProjectSummary,
  saveRemixProject,
} from "@/api/api-client";
import type { Job, SeedanceModelId } from "@/api/generated/types.gen";
import { AttachmentPicker, type AttachmentSelection } from "@/components/domain/attachment-picker";
import { AuthenticatedMedia } from "@/components/domain/authenticated-media";
import { type PromptReference, PromptWorkbench } from "@/components/domain/prompt-workbench";
import type { ApiJobResult, LibraryAsset, LibraryProduct } from "@/entities/types";
import type { CreationModelCapability } from "@/features/ai-creation/ai-creation-composer";
import { fetchPortraits, type Portrait } from "@/features/portrait-library/portrait-data";
import type { RemixPromptTool } from "../../../shared/video-remix/prompt-tools";
import {
  moveRemixSource,
  parseRemixAnalysisEntries,
  type RemixAnalysisEntry,
  remixMaxSources,
} from "../../../shared/video-remix/workflow";
import { PromptToolModal } from "./prompt-tool-modal";
import "./remix-project.css";

const stages = ["上传配置", "AI 解析", "提示词校对", "分镜校对", "合并成片"];
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

interface PromptVersion {
  id: string;
  label: string;
  prompt: string;
}

interface SourcePromptState {
  prompt: string;
  versions: PromptVersion[];
  activeVersionId: string;
}

interface ShotGenerationDraft {
  modelId: SeedanceModelId;
  ratio: string;
  resolution: string;
  duration: number;
  referenceMode: string;
  references: AttachmentSelection[];
  expanded: boolean;
}

function PublicPreviewImage({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (failed)
    return (
      <span className="public-image-error" role="img" aria-label={`${alt}加载失败`}>
        <ImageOff />
      </span>
    );

  return <img src={url} alt={alt} onError={() => setFailed(true)} />;
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
  sources,
  sourcesLocked,
  onSelectAttachments,
  onRemoveSource,
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
  sources: AttachmentSelection[];
  sourcesLocked: boolean;
  onSelectAttachments: (assets: AttachmentSelection[]) => void;
  onRemoveSource: (assetId: string) => void;
  onPick: (kind: "product" | "portrait" | "voice") => void;
}) {
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
        multiple
        trigger={(open) =>
          sources.length ? (
            <div className="uploaded-video-list">
              {sources.map((source, index) => (
                <div className="uploaded-video-preview" key={source.id}>
                  <div className="uploaded-video-player">
                    <AuthenticatedMedia
                      url={`/api/assets/${source.id}/content`}
                      mimeType={source.mimeType}
                      alt={source.name}
                      loadingText="正在载入原始片源…"
                      errorText="原始片源预览失败"
                    />
                  </div>
                  <div className="uploaded-video-meta">
                    <b title={source.name}>
                      {index + 1}. {source.name}
                    </b>
                    <button
                      type="button"
                      aria-label={`删除 ${source.name}`}
                      disabled={sourcesLocked}
                      onClick={() => onRemoveSource(source.id)}
                    >
                      <X />
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="append-video-button"
                onClick={open}
                disabled={sourcesLocked || sources.length >= remixMaxSources}
              >
                <Plus />
                {sourcesLocked
                  ? "解析后不可更换分镜"
                  : sources.length >= remixMaxSources
                    ? `最多 ${remixMaxSources} 条`
                    : "继续添加分镜视频"}
              </button>
              <small className="video-selection-count">
                已选 {sources.length}/{remixMaxSources} 条
              </small>
            </div>
          ) : (
            <button type="button" className="config-attachment-picker" disabled={sourcesLocked} onClick={open}>
              <Upload />
              <span>
                <b>选择分镜视频</b>
                <small>支持从素材库或本地多选，最多 {remixMaxSources} 条</small>
              </span>
            </button>
          )
        }
        onSelect={onSelectAttachments}
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
          <h2 className="text-ink">{title}</h2>
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
          <h2 className="text-ink">选择商品</h2>
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
          <h2 className="text-ink">选择人像</h2>
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

const remixProjectStageLabels: Record<RemixProjectSummary["currentStage"], string> = {
  upload: "上传配置",
  analysis: "AI 解析",
  prompt: "提示词校对",
  storyboard: "分镜校对",
  compose: "合并成片",
  completed: "已完成",
  failed: "失败",
};

function ProjectHistoryDrawer({
  open,
  currentProjectId,
  onClose,
  onContinue,
  onRenamed,
}: {
  open: boolean;
  currentProjectId?: string;
  onClose: () => void;
  onContinue: (project: RemixProjectDetail) => void | Promise<void>;
  onRenamed: (projectId: string, title: string) => void;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<"" | RemixProjectSummary["currentStage"]>("");
  const [appliedStage, setAppliedStage] = useState<"" | RemixProjectSummary["currentStage"]>("");
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState("");
  const [editingTitle, setEditingTitle] = useState("");
  const [busyId, setBusyId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const history = useQuery({
    queryKey: ["video-remix-projects", appliedQuery, appliedStage, page],
    queryFn: () =>
      fetchRemixProjects({
        query: appliedQuery || undefined,
        stage: appliedStage || undefined,
        page,
        pageSize: 8,
      }),
    enabled: open,
  });
  const totalPages = Math.max(1, Math.ceil((history.data?.total ?? 0) / (history.data?.pageSize ?? 8)));
  const renameProject = async (project: RemixProjectSummary) => {
    const title = editingTitle.trim();
    if (!title || title === project.title) {
      setEditingId("");
      return;
    }
    setBusyId(project.id);
    setErrorMessage("");
    try {
      await saveRemixProject(project.id, { title });
      onRenamed(project.id, title);
      setEditingId("");
      await queryClient.invalidateQueries({ queryKey: ["video-remix-projects"] });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "项目重命名失败");
    } finally {
      setBusyId("");
    }
  };
  const continueProject = async (projectId: string) => {
    setBusyId(projectId);
    setErrorMessage("");
    try {
      await onContinue(await fetchRemixProject(projectId));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "项目恢复失败");
    } finally {
      setBusyId("");
    }
  };
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
            <input value={query} placeholder="搜索项目名称" onChange={(event) => setQuery(event.target.value)} />
            <Search />
          </label>
          <select
            aria-label="项目进度"
            value={stageFilter}
            onChange={(event) => setStageFilter(event.target.value as typeof stageFilter)}
          >
            <option value="">全部进度</option>
            {Object.entries(remixProjectStageLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            className="history-search"
            onClick={() => {
              setAppliedQuery(query.trim());
              setAppliedStage(stageFilter);
              setPage(1);
            }}
          >
            查询
          </button>
        </div>
        {(errorMessage || history.error) && (
          <button className="history-error" onClick={() => void history.refetch()}>
            {errorMessage || (history.error instanceof Error ? history.error.message : "项目记录加载失败")}，点击重试
          </button>
        )}
        <div className="history-table">
          <div className="history-head">
            <span>项目名称</span>
            <span>项目进度</span>
            <span>创建人</span>
            <span>更新时间</span>
            <span>操作</span>
          </div>
          {history.data?.projects.map((project) => (
            <div className={`history-row ${project.id === currentProjectId ? "current" : ""}`} key={project.id}>
              <span>
                {editingId === project.id ? (
                  <input
                    className="history-title-input"
                    value={editingTitle}
                    maxLength={80}
                    disabled={busyId === project.id}
                    onChange={(event) => setEditingTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void renameProject(project);
                      if (event.key === "Escape") setEditingId("");
                    }}
                  />
                ) : (
                  <b>
                    {project.title}
                    <button
                      aria-label={`重命名 ${project.title}`}
                      onClick={() => {
                        setEditingId(project.id);
                        setEditingTitle(project.title);
                      }}
                    >
                      <Pencil />
                    </button>
                  </b>
                )}
                <small>产品：{project.productName}</small>
              </span>
              <span>
                <i className={project.currentStage}>
                  {remixProjectStageLabels[project.currentStage]}
                  {project.currentStage === "storyboard" && ` ${project.generatedCount} / ${project.sourceCount}`}
                </i>
              </span>
              <span>{project.createdBy}</span>
              <span className="history-time">{new Date(project.updatedAt).toLocaleString()}</span>
              <span>
                {editingId === project.id ? (
                  <button disabled={busyId === project.id} onClick={() => void renameProject(project)}>
                    保存
                  </button>
                ) : (
                  <button disabled={busyId === project.id} onClick={() => void continueProject(project.id)}>
                    {busyId === project.id ? "加载中" : "继续创作"}
                  </button>
                )}
              </span>
            </div>
          ))}
          {history.isLoading && <div className="history-empty">正在加载项目记录…</div>}
          {!history.isLoading && !history.data?.projects.length && <div className="history-empty">暂无项目记录</div>}
        </div>
        <footer>
          <span>共 {history.data?.total ?? 0} 条</span>
          <button disabled={page <= 1 || history.isFetching} onClick={() => setPage((value) => value - 1)}>
            <ChevronLeft />
          </button>
          <b>{page}</b>
          <button disabled={page >= totalPages || history.isFetching} onClick={() => setPage((value) => value + 1)}>
            <ChevronRight />
          </button>
        </footer>
      </aside>
    </div>
  );
}

export function RemixProject() {
  const queryClient = useQueryClient();
  const lastSavedWorkspace = useRef("");
  const [stage, setStage] = useState(0);
  const [parsed, setParsed] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [promptStates, setPromptStates] = useState<Record<string, SourcePromptState>>({});
  const [promptTool, setPromptTool] = useState<RemixPromptTool | null>(null);
  const [sources, setSources] = useState<AttachmentSelection[]>([]);
  const [activeSourceId, setActiveSourceId] = useState("");
  const [composeOrder, setComposeOrder] = useState<string[]>([]);
  const [composePreviewId, setComposePreviewId] = useState("");
  const [shotDrafts, setShotDrafts] = useState<Record<string, ShotGenerationDraft>>({});
  const [selectedShotAssets, setSelectedShotAssets] = useState<Record<string, string>>({});
  const [shotSelectionTouched, setShotSelectionTouched] = useState<Record<string, boolean>>({});
  const [draggingSourceId, setDraggingSourceId] = useState("");
  const [mode, setMode] = useState<"product" | "talking">("product");
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [compare, setCompare] = useState(false);
  const [notice, setNotice] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [composeJob, setComposeJob] = useState<Job | null>(null);
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
  const activePromptState = promptStates[activeSourceId] ?? { prompt: "", versions: [], activeVersionId: "" };
  const prompt = activePromptState.prompt;
  const promptVersions = activePromptState.versions;
  const activePromptVersionId = activePromptState.activeVersionId;
  const analysisEntries = useMemo(
    () => parseRemixAnalysisEntries(job?.values.analysisEntries || job?.result?.data?.values.analysisEntries),
    [job],
  );
  const activeAnalysisEntry = analysisEntries.find((entry) => entry.assetId === activeSourceId);
  const { data: creationCapabilities } = useQuery({
    queryKey: ["creation-capabilities"],
    queryFn: fetchCreationCapabilities,
  });
  const videoModels = (creationCapabilities?.models ?? []).filter(
    (model): model is CreationModelCapability & { id: SeedanceModelId } => model.kind === "video" && model.enabled,
  );
  const defaultVideoModel = videoModels.find((model) => model.isDefault) ?? videoModels[0];
  const { data: shotJobs = [], refetch: refetchShotJobs } = useQuery({
    queryKey: ["video-remix-shot-jobs", job?.id],
    queryFn: () => fetchRemixShotJobs(job?.id || ""),
    enabled: Boolean(job?.id && parsed),
    refetchInterval: (query) =>
      query.state.data?.some((shotJob) => shotJob.status === "queued" || shotJob.status === "processing")
        ? 2_500
        : false,
  });

  useEffect(() => {
    if (!defaultVideoModel) return;
    setShotDrafts((current) => {
      let changed = false;
      const next = { ...current };
      for (const source of sources) {
        if (next[source.id]) continue;
        const productImage = selectedProduct?.images[0];
        next[source.id] = {
          modelId: defaultVideoModel.id,
          ratio: defaultVideoModel.supportedRatios.includes("9:16")
            ? "9:16"
            : defaultVideoModel.supportedRatios[0] || "9:16",
          resolution: defaultVideoModel.supportedResolutions.includes("720p")
            ? "720p"
            : defaultVideoModel.supportedResolutions[0] || "720p",
          duration: defaultVideoModel.supportedDurations.includes(5) ? 5 : defaultVideoModel.supportedDurations[0] || 5,
          referenceMode: defaultVideoModel.referenceModes[0] || "omni",
          references: productImage
            ? [
                {
                  id: productImage.id,
                  name: productImage.name,
                  mimeType: productImage.mimeType,
                  size: productImage.size,
                  url: productImage.url,
                  source: "library",
                },
              ]
            : [],
          expanded: false,
        };
        changed = true;
      }
      return changed ? next : current;
    });
  }, [defaultVideoModel, selectedProduct, sources]);

  useEffect(() => {
    setSelectedShotAssets((current) => {
      const next = { ...current };
      let changed = false;
      for (const source of sources) {
        const latest = shotJobs.find(
          (shotJob) => shotJob.values.sourceAssetId === source.id && shotJob.status === "succeeded",
        );
        const artifact = (latest?.result as ApiJobResult | undefined)?.artifacts.find((item) =>
          item.mimeType.startsWith("video/"),
        );
        const selectedId = artifact?.id ?? source.id;
        if (!shotSelectionTouched[source.id] && next[source.id] !== selectedId) {
          next[source.id] = selectedId;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [shotJobs, shotSelectionTouched, sources]);

  useEffect(() => {
    if (!job?.id || !parsed || !sources.length) return;
    const sourceIds = sources.map((source) => source.id);
    if (!sourceIds.every((sourceId) => selectedShotAssets[sourceId])) return;
    const workspace: RemixProjectDetail["workspace"] = {
      stage,
      promptStates,
      selectedShotAssets: Object.fromEntries(sourceIds.map((sourceId) => [sourceId, selectedShotAssets[sourceId]])),
      composeOrder,
      composePreviewId,
    };
    const serialized = JSON.stringify(workspace);
    if (serialized === lastSavedWorkspace.current) return;
    const timer = window.setTimeout(() => {
      void saveRemixProject(job.id, { workspace })
        .then((updated) => {
          lastSavedWorkspace.current = serialized;
          setJob((current) => (current?.id === updated.id ? updated : current));
          void queryClient.invalidateQueries({ queryKey: ["video-remix-projects"] });
        })
        .catch((error) => setNotice(error instanceof Error ? error.message : "项目进度保存失败"));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [composeOrder, composePreviewId, job?.id, parsed, promptStates, queryClient, selectedShotAssets, sources, stage]);

  const patchPromptState = useCallback((assetId: string, update: (current: SourcePromptState) => SourcePromptState) => {
    if (!assetId) return;
    setPromptStates((current) => {
      const existing = current[assetId] ?? { prompt: "", versions: [], activeVersionId: "" };
      return { ...current, [assetId]: update(existing) };
    });
  }, []);
  const setPrompt = useCallback(
    (value: string) => patchPromptState(activeSourceId, (current) => ({ ...current, prompt: value })),
    [activeSourceId, patchPromptState],
  );
  const setActivePromptVersionId = useCallback(
    (value: string) => patchPromptState(activeSourceId, (current) => ({ ...current, activeVersionId: value })),
    [activeSourceId, patchPromptState],
  );

  const hydrateAnalysisEntries = useCallback((sourceJobId: string, entries: RemixAnalysisEntry[]) => {
    setPromptStates((current) => {
      const next = { ...current };
      for (const entry of entries) {
        if (entry.status !== "succeeded" || !entry.prompt || next[entry.assetId]?.versions.length) continue;
        const versionId = `${sourceJobId}:${entry.assetId}`;
        next[entry.assetId] = {
          prompt: entry.prompt,
          versions: [{ id: versionId, label: "AI解析", prompt: entry.prompt }],
          activeVersionId: versionId,
        };
      }
      return next;
    });
    const firstSucceeded = entries.find((entry) => entry.status === "succeeded");
    if (firstSucceeded)
      setActiveSourceId((current) =>
        entries.some((entry) => entry.assetId === current && entry.status === "succeeded")
          ? current
          : firstSucceeded.assetId,
      );
  }, []);

  useEffect(() => {
    if (!activeJobId) return;
    const refresh = () => {
      void fetchJob(activeJobId)
        .then((updated) => {
          setJob(updated);
          const entries = parseRemixAnalysisEntries(
            updated.values.analysisEntries || updated.result?.data?.values.analysisEntries,
          );
          if (entries.length) hydrateAnalysisEntries(updated.id, entries);
          if (updated.status === "failed") {
            setParsing(false);
            setNotice(updated.error?.message || "视频解析失败，请稍后重试");
            return;
          }
          if (
            (updated.status === "succeeded" || updated.status === "partially_succeeded") &&
            entries.length &&
            !parsed
          ) {
            setParsed(true);
            setParsing(false);
            setStage(2);
            setNotice(updated.status === "partially_succeeded" ? updated.result?.summary || "部分视频解析失败" : "");
          }
        })
        .catch(() => setNotice("任务状态刷新失败，将在 10 秒后重试"));
    };
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => window.clearInterval(timer);
  }, [activeJobId, hydrateAnalysisEntries, parsed]);

  const activeComposeJobId =
    composeJob && (composeJob.status === "queued" || composeJob.status === "processing") ? composeJob.id : null;
  useEffect(() => {
    if (!activeComposeJobId) return;
    const refresh = () => {
      void fetchJob(activeComposeJobId)
        .then((updated) => {
          setComposeJob(updated);
          if (updated.status === "failed") setNotice(updated.error?.message || "视频合并失败，请稍后重试");
          if (updated.status === "succeeded") setNotice("合并成片已生成并保存到素材库");
        })
        .catch(() => setNotice("合并任务状态刷新失败，将自动重试"));
    };
    refresh();
    const timer = window.setInterval(refresh, 2_000);
    return () => window.clearInterval(timer);
  }, [activeComposeJobId]);

  const parse = async () => {
    if (parsing) return;
    if (!sources.length || !selectedProduct) {
      setNotice(sources.length ? "请先从商品库选择商品" : "请先上传分镜视频并选择商品");
      setStage(0);
      return;
    }
    setParsed(false);
    setParsing(true);
    setStage(1);
    setNotice("");
    try {
      const portraitAssetId = selectedPortrait?.source_url.match(/\/([^/]+)\.png(?:\?|$)/)?.[1] ?? null;
      const created = await generateRemixProject({
        projectName:
          projectName.trim() ||
          `爆款二创 · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        mode,
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
        rawMaterialFiles: sources.map((source) => {
          const videoUrl = `/api/assets/${source.id}/content`;
          return {
            filename: source.name,
            objectKey: source.id,
            fileMd5: null,
            fileUrl: videoUrl,
            coverUrl: videoUrl,
            fileType: "VIDEO",
            duration: null,
            reasoningEffort: "high",
          };
        }),
        voiceAsset: selectedVoice
          ? {
              filename: selectedVoice.originalName,
              objectKey: selectedVoice.id,
              fileUrl: selectedVoice.url,
              coverUrl: selectedVoice.url,
              fileType: "AUDIO",
              durationSec: selectedVoice.durationSec ?? null,
            }
          : null,
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
      setComposeOrder(sources.map((source) => source.id));
      setComposePreviewId(sources[0]?.id || "");
      setActiveSourceId(sources[0]?.id || "");
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
    setSources([]);
    setActiveSourceId("");
    setComposeOrder([]);
    setComposePreviewId("");
    setShotDrafts({});
    setSelectedShotAssets({});
    setShotSelectionTouched({});
    setDraggingSourceId("");
    setProjectName("");
    setDescription("");
    setPromptStates({});
    setPromptTool(null);
    setJob(null);
    setComposeJob(null);
    setNotice("");
    lastSavedWorkspace.current = "";
  };
  const restoreProject = useCallback(
    (detail: RemixProjectDetail) => {
      const request = detail.projectRequest;
      const restoredSources: AttachmentSelection[] = request.rawMaterialFiles.map((file) => ({
        id: file.objectKey,
        name: file.filename,
        mimeType: "video/mp4",
        url: `/api/assets/${file.objectKey}/content`,
        source: "library",
      }));
      const productImages: LibraryAsset[] = request.product.productImages.flatMap((image) => {
        if (!image.metaId) return [];
        return [
          {
            id: image.metaId,
            name: image.filename,
            originalName: image.filename,
            mimeType: "image/jpeg",
            size: 0,
            kind: "product" as const,
            description: image.aiDescription,
            url: `/api/assets/${image.metaId}/content`,
            createdAt: detail.rootJob.createdAt,
          },
        ];
      });
      const productId =
        typeof request.product.id === "string" || typeof request.product.id === "number"
          ? String(request.product.id)
          : detail.rootJob.values.product?.split(":")[1] || detail.rootJob.id;
      setSelectedProduct({
        id: productId,
        name: request.product.productName,
        description: request.product.productFormDesc,
        sharingScope: "private",
        images: productImages,
        createdAt: detail.rootJob.createdAt,
      });
      const portrait = request.portraitAssets?.[0];
      const portraitFile = portrait?.fileInfo[0];
      setSelectedPortrait(
        portrait && portraitFile
          ? {
              name: portrait.assetName,
              profession: portrait.occupation || "",
              source_url: portraitFile.fileUrl,
              index: Number(portrait.id) || 0,
              description: portrait.description,
              gender: portrait.gender,
              age: portrait.age,
            }
          : null,
      );
      const voice = request.voiceAsset;
      setSelectedVoice(
        voice
          ? {
              id: voice.objectKey,
              name: voice.filename,
              originalName: voice.filename,
              mimeType: "audio/mpeg",
              size: 0,
              durationSec: voice.durationSec,
              kind: "voice",
              url: `/api/assets/${voice.objectKey}/content`,
              createdAt: detail.rootJob.createdAt,
            }
          : null,
      );
      const rootReady = detail.rootJob.status === "succeeded" || detail.rootJob.status === "partially_succeeded";
      const shotHistory = detail.childJobs.filter((child) => child.values.workflowPhase === "shot-generation");
      const latestCompose = detail.childJobs.find((child) => child.values.workflowPhase === "compose") ?? null;
      lastSavedWorkspace.current = JSON.stringify(detail.workspace);
      queryClient.setQueryData(["video-remix-shot-jobs", detail.rootJob.id], shotHistory);
      setMode(request.mode ?? "product");
      setProjectName(detail.project.title);
      setDescription(request.demand ?? "");
      setSources(restoredSources);
      setJob(detail.rootJob);
      setParsed(rootReady);
      setParsing(detail.rootJob.status === "queued" || detail.rootJob.status === "processing");
      setStage(rootReady ? detail.workspace.stage : 1);
      setPromptStates(detail.workspace.promptStates);
      setSelectedShotAssets(detail.workspace.selectedShotAssets);
      setShotSelectionTouched(Object.fromEntries(restoredSources.map((source) => [source.id, true])));
      setComposeOrder(detail.workspace.composeOrder);
      setComposePreviewId(detail.workspace.composePreviewId);
      setActiveSourceId(detail.workspace.composePreviewId || restoredSources[0]?.id || "");
      setComposeJob(latestCompose);
      setShotDrafts({});
      setEditing(false);
      setPromptTool(null);
      setHistoryOpen(false);
      setNotice(
        detail.missingAssetIds.length
          ? `项目已恢复，但有 ${detail.missingAssetIds.length} 个素材已不存在`
          : "项目已恢复",
      );
    },
    [queryClient],
  );
  const applyPromptTool = useCallback(
    (tool: RemixPromptTool, rewrittenPrompt: string, summary: string, findings: string[]) => {
      const nextVersionId = `${tool}-${Date.now()}`;
      patchPromptState(activeSourceId, (current) => {
        const versions = current.versions.some((version) => version.prompt === current.prompt)
          ? current.versions
          : [...current.versions, { id: `manual-${Date.now()}`, label: "手动修改", prompt: current.prompt }];
        return {
          prompt: rewrittenPrompt,
          activeVersionId: nextVersionId,
          versions: [
            ...versions,
            {
              id: nextVersionId,
              label: tool === "check" ? "AI检查" : tool === "modify" ? "AI修改" : "换口播",
              prompt: rewrittenPrompt,
            },
          ],
        };
      });
      setNotice(findings.length ? `${summary}（处理 ${findings.length} 项）` : summary);
    },
    [activeSourceId, patchPromptState],
  );
  const result = composeJob?.result as ApiJobResult | undefined;
  const resultVideo = result?.artifacts.find((artifact) => artifact.mimeType.startsWith("video/") && artifact.url);
  const orderedPromptVersions = useMemo(
    () => promptVersions.map((version, index) => ({ ...version, sequence: index + 1 })).reverse(),
    [promptVersions],
  );
  const promptVersionButton = (version: PromptVersion & { sequence: number }) => (
    <button
      key={version.id}
      className={version.id === activePromptVersionId ? "active" : ""}
      onClick={() => {
        setPrompt(version.prompt);
        setActivePromptVersionId(version.id);
        setEditing(false);
      }}
    >
      <b>v{version.sequence}</b>
      <small>{version.label}</small>
      {version.id === activePromptVersionId && <Check />}
    </button>
  );
  const activeSource = sources.find((source) => source.id === activeSourceId) ?? sources[0];
  const sourceAssetId = activeSource?.id || "";
  const fileName = activeSource?.name || "未选择视频";
  const activeDraft = shotDrafts[sourceAssetId];
  const activeModel = videoModels.find((model) => model.id === activeDraft?.modelId) ?? defaultVideoModel;
  const activeShotJobs = shotJobs.filter((shotJob) => shotJob.values.sourceAssetId === sourceAssetId);
  const activeShotRunning = activeShotJobs.find(
    (shotJob) => shotJob.status === "queued" || shotJob.status === "processing",
  );
  const activeShotVersions = activeShotJobs.flatMap((shotJob) => {
    if (shotJob.status !== "succeeded") return [];
    const artifact = (shotJob.result as ApiJobResult | undefined)?.artifacts.find((item) =>
      item.mimeType.startsWith("video/"),
    );
    return artifact ? [{ job: shotJob, artifact }] : [];
  });
  const activeSelectedAssetId = selectedShotAssets[sourceAssetId] ?? sourceAssetId;
  const activeGeneratedVersion = activeShotVersions.find(({ artifact }) => artifact.id === activeSelectedAssetId);
  const activeGeneratedSequence = activeGeneratedVersion
    ? activeShotVersions.length - activeShotVersions.indexOf(activeGeneratedVersion)
    : 0;
  const activePreview = activeGeneratedVersion?.artifact ?? {
    id: sourceAssetId,
    name: fileName,
    mimeType: activeSource?.mimeType || "video/mp4",
    url: sourceAssetId ? `/api/assets/${sourceAssetId}/content` : undefined,
  };
  const promptReferences: PromptReference[] = activeSource
    ? [
        { id: activeSource.id, name: activeSource.name, kind: "video" },
        ...(activeDraft?.references ?? []).map((reference) => ({
          id: reference.id,
          name: reference.name,
          kind: reference.mimeType.startsWith("image/") ? ("image" as const) : ("audio" as const),
        })),
      ]
    : [];
  const patchShotDraft = (update: Partial<ShotGenerationDraft>) => {
    if (!sourceAssetId || !activeDraft) return;
    setShotDrafts((current) => ({
      ...current,
      [sourceAssetId]: { ...current[sourceAssetId], ...update },
    }));
  };
  const submitShotGeneration = async () => {
    if (!job?.id || !sourceAssetId || !activeDraft || activeShotRunning) return;
    if (prompt.trim().length < 20) {
      setNotice("分镜生成提示词至少需要 20 个字符");
      return;
    }
    setNotice("");
    try {
      await generateRemixShot({
        sourceJobId: job.id,
        sourceAssetId,
        prompt,
        modelId: activeDraft.modelId,
        ratio: activeDraft.ratio,
        resolution: activeDraft.resolution,
        duration: activeDraft.duration,
        referenceMode: activeDraft.referenceMode,
        referenceAssetIds: activeDraft.references.map((reference) => reference.id),
        generateAudio: true,
      });
      setShotSelectionTouched((current) => ({ ...current, [sourceAssetId]: false }));
      setNotice("当前分镜已提交生成，可继续处理其他分镜");
      await refetchShotJobs();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "分镜生成任务提交失败");
    }
  };
  const orderedSources = composeOrder
    .map((assetId) => sources.find((source) => source.id === assetId))
    .filter((source): source is AttachmentSelection => Boolean(source));
  const composePreviewSource =
    orderedSources.find((source) => source.id === composePreviewId) ?? orderedSources[0] ?? sources[0];
  const selectedComposeAssetId = composePreviewSource
    ? (selectedShotAssets[composePreviewSource.id] ?? composePreviewSource.id)
    : "";
  const selectedComposeVersion = shotJobs
    .filter((shotJob) => shotJob.values.sourceAssetId === composePreviewSource?.id && shotJob.status === "succeeded")
    .flatMap((shotJob) => (shotJob.result as ApiJobResult | undefined)?.artifacts ?? [])
    .find((artifact) => artifact.id === selectedComposeAssetId);
  const moveComposeSource = (assetId: string, direction: -1 | 1) => {
    setComposeOrder((current) => {
      const fromIndex = current.indexOf(assetId);
      const toIndex = fromIndex + direction;
      return moveRemixSource(current, fromIndex, toIndex);
    });
    setComposeJob(null);
  };
  const startCompose = async () => {
    if (!job?.id || composeOrder.length < 2 || activeComposeJobId) return;
    setNotice("");
    try {
      setComposeJob(
        await composeRemixVideos({
          sourceJobId: job.id,
          sources: composeOrder.map((sourceId) => ({
            sourceAssetId: sourceId,
            selectedAssetId: selectedShotAssets[sourceId] ?? sourceId,
          })),
        }),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "合并任务提交失败");
    }
  };
  const currentWorkspace = (): RemixProjectDetail["workspace"] | undefined => {
    if (!job?.id || !parsed || !sources.length) return undefined;
    const sourceIds = sources.map((source) => source.id);
    if (!sourceIds.every((sourceId) => selectedShotAssets[sourceId])) return undefined;
    return {
      stage,
      promptStates,
      selectedShotAssets: Object.fromEntries(sourceIds.map((sourceId) => [sourceId, selectedShotAssets[sourceId]])),
      composeOrder,
      composePreviewId,
    };
  };
  const saveCurrentProject = async () => {
    const workspace = currentWorkspace();
    if (!job?.id || !workspace) return;
    await saveRemixProject(job.id, { workspace });
    lastSavedWorkspace.current = JSON.stringify(workspace);
  };
  const startNewProject = async () => {
    try {
      await saveCurrentProject();
      reset();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "当前项目保存失败");
    }
  };

  return (
    <div className="remix-project">
      <WorkflowHeader
        stage={stage}
        onStage={setStage}
        onHistory={() => setHistoryOpen(true)}
        onReset={() => void startNewProject()}
      />
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
          sources={sources}
          sourcesLocked={Boolean(job) || parsing}
          onSelectAttachments={(selected) => {
            if (job || parsing) return;
            setSources((current) => {
              const seen = new Set(current.map((source) => source.id));
              const additions = selected.filter((source) => !seen.has(source.id));
              const nextSources = [...current, ...additions].slice(0, remixMaxSources);
              setActiveSourceId((active) => active || nextSources[0]?.id || "");
              return nextSources;
            });
          }}
          onRemoveSource={(assetId) => {
            if (job || parsing) return;
            setSources((current) => {
              const nextSources = current.filter((source) => source.id !== assetId);
              setActiveSourceId((active) => (active === assetId ? nextSources[0]?.id || "" : active));
              return nextSources;
            });
            setPromptStates((current) => {
              const next = { ...current };
              delete next[assetId];
              return next;
            });
            setComposeOrder((current) => current.filter((id) => id !== assetId));
            setComposePreviewId((current) => (current === assetId ? "" : current));
            setComposeJob(null);
          }}
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
              {sources.map((source, index) => {
                const entry = analysisEntries.find((item) => item.assetId === source.id);
                const latestShot = shotJobs.find((shotJob) => shotJob.values.sourceAssetId === source.id);
                return (
                  <button
                    key={source.id}
                    className={source.id === activeSourceId ? "active" : ""}
                    onClick={() => {
                      setActiveSourceId(source.id);
                      setEditing(false);
                    }}
                  >
                    <span className="source-mini">
                      <AuthenticatedMedia
                        url={`/api/assets/${selectedShotAssets[source.id] ?? source.id}/content`}
                        mimeType="video/mp4"
                        alt={`${source.name}${selectedShotAssets[source.id] && selectedShotAssets[source.id] !== source.id ? "生成版本" : "原片"}`}
                        controls={false}
                        loadingText="载入中…"
                        errorText="预览失败"
                      />
                    </span>
                    <b>{source.name}</b>
                    <i>
                      {entry?.status === "failed"
                        ? "解析失败"
                        : latestShot?.status === "queued" || latestShot?.status === "processing"
                          ? "生成中"
                          : latestShot?.status === "succeeded"
                            ? "已生成"
                            : latestShot?.status === "failed"
                              ? "生成失败"
                              : `v${index + 1}`}
                    </i>
                  </button>
                );
              })}
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
                  <button disabled={!prompt} onClick={() => setPromptTool("check")}>
                    <CircleCheck />
                    智能检查
                  </button>
                  <button className="purple" disabled={!prompt} onClick={() => setPromptTool("modify")}>
                    <Pencil />
                    智能修改
                  </button>
                  <button className="orange" disabled={!prompt} onClick={() => setPromptTool("voice")}>
                    <Mic2 />
                    换口播
                  </button>
                </div>
              </div>
              <div className="prompt-content">
                <aside>
                  {orderedPromptVersions[0] && promptVersionButton(orderedPromptVersions[0])}
                  {orderedPromptVersions.length > 1 && <p>历史版本</p>}
                  {orderedPromptVersions.slice(1).map(promptVersionButton)}
                </aside>
                <div className="prompt-document">
                  {activeAnalysisEntry?.status === "failed" ? (
                    <div className="source-analysis-error">
                      <b>该视频解析失败</b>
                      <span>{activeAnalysisEntry.error || "请稍后重试"}</span>
                    </div>
                  ) : editing ? (
                    <textarea
                      value={prompt}
                      onChange={(event) => {
                        setPrompt(event.target.value);
                        setActivePromptVersionId("");
                      }}
                    />
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
                    结果预览 <i>{activeGeneratedVersion ? `v${activeGeneratedSequence}` : "原片"}</i>
                  </b>
                  <button disabled={!activeShotVersions.length}>
                    <Clock3 />
                    版本历史（{activeShotVersions.length + 1}）
                  </button>
                </header>
                <div className="result-main">
                  <div className="result-video">
                    {activePreview.url ? (
                      <AuthenticatedMedia
                        key={activePreview.id}
                        url={activePreview.url}
                        mimeType={activePreview.mimeType}
                        alt={activePreview.name}
                        loadingText="正在载入分镜视频…"
                        errorText="分镜视频加载失败"
                      />
                    ) : (
                      <div className="result-media-empty">
                        <Video />
                        <span>未选择分镜视频</span>
                      </div>
                    )}
                  </div>
                  <div className="result-info">
                    <h3>{activeGeneratedVersion ? activeGeneratedVersion.job.videoModel : "原始片源"}</h3>
                    <p>
                      {activeGeneratedVersion
                        ? new Date(activeGeneratedVersion.job.createdAt).toLocaleString()
                        : "未生成时将使用原始片源参与合成"}
                    </p>
                    <div className="result-assets">
                      {selectedProduct?.images.slice(0, 4).map((image) => (
                        <span className="result-asset" key={image.id}>
                          <AuthenticatedMedia
                            url={image.url}
                            mimeType={image.mimeType}
                            alt={image.name}
                            loadingText="加载中…"
                            errorText="加载失败"
                          />
                        </span>
                      ))}
                      {selectedPortrait && (
                        <span className="result-asset">
                          <PublicPreviewImage
                            key={selectedPortrait.source_url}
                            url={selectedPortrait.source_url}
                            alt={selectedPortrait.name}
                          />
                        </span>
                      )}
                      {!selectedProduct?.images.length && !selectedPortrait && (
                        <span className="result-assets-empty">未选择图片素材</span>
                      )}
                    </div>
                    <div className="result-meta">
                      <i>{activeDraft?.duration ?? 5}秒</i>
                      <i>{activeDraft?.ratio ?? "9:16"}</i>
                      <i>{activeDraft?.resolution ?? "720p"}</i>
                      <i>{activeGeneratedVersion?.artifact.executionMode ?? "原片"}</i>
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
                      <button
                        disabled={!activeGeneratedVersion?.artifact.url}
                        onClick={() => {
                          if (activeGeneratedVersion?.artifact.url)
                            void downloadAuthenticated(
                              activeGeneratedVersion.artifact.url,
                              activeGeneratedVersion.artifact.name,
                            );
                        }}
                      >
                        <Download />
                        下载
                      </button>
                    </div>
                  </div>
                </div>
              </article>
              <div className="shot-version-strip">
                <button
                  className={activeSelectedAssetId === sourceAssetId ? "active" : ""}
                  onClick={() => {
                    setSelectedShotAssets((current) => ({ ...current, [sourceAssetId]: sourceAssetId }));
                    setShotSelectionTouched((current) => ({ ...current, [sourceAssetId]: true }));
                  }}
                >
                  <b>原片</b>
                  <small>用于合成</small>
                </button>
                {activeShotVersions.map(({ artifact }, index) => (
                  <button
                    key={artifact.id}
                    className={activeSelectedAssetId === artifact.id ? "active" : ""}
                    onClick={() => {
                      setSelectedShotAssets((current) => ({ ...current, [sourceAssetId]: artifact.id }));
                      setShotSelectionTouched((current) => ({ ...current, [sourceAssetId]: true }));
                    }}
                  >
                    <b>生成 v{activeShotVersions.length - index}</b>
                    <small>{artifact.executionMode}</small>
                  </button>
                ))}
                {activeShotRunning && (
                  <span>
                    <LoaderCircle className="animate-spin" />
                    {activeShotRunning.stage} {activeShotRunning.progress}%
                  </span>
                )}
                {activeShotJobs[0]?.status === "failed" && (
                  <span className="failed">{activeShotJobs[0].error?.message}</span>
                )}
              </div>
              {activeDraft && (
                <PromptWorkbench
                  embedded
                  expanded={activeDraft.expanded}
                  references={promptReferences}
                  lockedReferenceIds={sourceAssetId ? [sourceAssetId] : []}
                  prompt={prompt}
                  placeholder="描述当前镜头的动作、主体、场景与运镜"
                  inputLabel="当前分镜生成提示词"
                  accept="image/*,audio/*"
                  multiple
                  submitting={Boolean(activeShotRunning)}
                  onChooseAssets={(assets) => {
                    const merged = [...activeDraft.references];
                    for (const asset of assets) {
                      const kind = asset.mimeType.split("/")[0];
                      const existingIndex = merged.findIndex((item) => item.mimeType.startsWith(`${kind}/`));
                      if (existingIndex >= 0) merged.splice(existingIndex, 1, asset);
                      else merged.push(asset);
                    }
                    patchShotDraft({ references: merged.slice(0, 2) });
                  }}
                  onRemoveReference={(id) =>
                    patchShotDraft({ references: activeDraft.references.filter((reference) => reference.id !== id) })
                  }
                  onPromptChange={(value) => {
                    setPrompt(value);
                    setActivePromptVersionId("");
                  }}
                  onExpandedChange={(expanded) => patchShotDraft({ expanded })}
                  onSubmit={() => void submitShotGeneration()}
                  controls={
                    <>
                      <select
                        aria-label="视频模型"
                        value={activeDraft.modelId}
                        onChange={(event) => {
                          const model = videoModels.find((item) => item.id === event.target.value);
                          if (!model) return;
                          patchShotDraft({
                            modelId: model.id,
                            ratio: model.supportedRatios.includes(activeDraft.ratio)
                              ? activeDraft.ratio
                              : model.supportedRatios[0],
                            resolution: model.supportedResolutions.includes(activeDraft.resolution)
                              ? activeDraft.resolution
                              : model.supportedResolutions[0],
                            duration: model.supportedDurations.includes(activeDraft.duration)
                              ? activeDraft.duration
                              : model.supportedDurations[0],
                            referenceMode: model.referenceModes[0] || "omni",
                          });
                        }}
                      >
                        {videoModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.displayName}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="画面比例"
                        value={activeDraft.ratio}
                        onChange={(event) => patchShotDraft({ ratio: event.target.value })}
                      >
                        {(activeModel?.supportedRatios ?? []).map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                      <select
                        aria-label="清晰度"
                        value={activeDraft.resolution}
                        onChange={(event) => patchShotDraft({ resolution: event.target.value })}
                      >
                        {(activeModel?.supportedResolutions ?? []).map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                      <select
                        aria-label="视频时长"
                        value={activeDraft.duration}
                        onChange={(event) => patchShotDraft({ duration: Number(event.target.value) })}
                      >
                        {(activeModel?.supportedDurations ?? []).map((value) => (
                          <option key={value} value={value}>
                            {value}秒
                          </option>
                        ))}
                      </select>
                    </>
                  }
                />
              )}
              {!activeDraft && <div className="shot-generation-unavailable">当前没有已启用的视频生成模型</div>}
              <footer className="stage-actions shot-stage-actions">
                <span>未生成的镜头将直接使用原始片源</span>
                <button className="primary" onClick={() => setStage(4)}>
                  下一步
                </button>
              </footer>
            </div>
          )}
          {stage === 4 && (
            <div className="compose-stage">
              <div className="compose-top">
                <div>
                  <b>成片时间线</b>
                  <span>拖拽片段调整顺序</span>
                </div>
                <i>
                  {orderedSources.length}/{sources.length} 片段就绪
                </i>
              </div>
              <div className="timeline">
                {orderedSources.map((source, index) => (
                  <article
                    key={source.id}
                    className={source.id === composePreviewSource?.id ? "active" : ""}
                    draggable
                    onDragStart={() => setDraggingSourceId(source.id)}
                    onDragEnd={() => setDraggingSourceId("")}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      setComposeOrder((current) =>
                        moveRemixSource(current, current.indexOf(draggingSourceId), current.indexOf(source.id)),
                      );
                      setComposeJob(null);
                      setDraggingSourceId("");
                    }}
                  >
                    <button
                      type="button"
                      className="timeline-preview-button"
                      onClick={() => setComposePreviewId(source.id)}
                    >
                      <AuthenticatedMedia
                        url={`/api/assets/${selectedShotAssets[source.id] ?? source.id}/content`}
                        mimeType="video/mp4"
                        alt={`${source.name}${selectedShotAssets[source.id] && selectedShotAssets[source.id] !== source.id ? "生成版本" : "原片"}`}
                        controls={false}
                        loadingText="载入中…"
                        errorText="预览失败"
                      />
                      <b>{index + 1}</b>
                    </button>
                    <footer>
                      <span title={source.name}>
                        {source.name}
                        <small>
                          {selectedShotAssets[source.id] && selectedShotAssets[source.id] !== source.id
                            ? "生成版本"
                            : "原片"}
                        </small>
                      </span>
                      <div>
                        <button
                          type="button"
                          aria-label={`前移 ${source.name}`}
                          disabled={index === 0}
                          onClick={() => moveComposeSource(source.id, -1)}
                        >
                          <ChevronLeft />
                        </button>
                        <button
                          type="button"
                          aria-label={`后移 ${source.name}`}
                          disabled={index === orderedSources.length - 1}
                          onClick={() => moveComposeSource(source.id, 1)}
                        >
                          <ChevronRight />
                        </button>
                      </div>
                    </footer>
                  </article>
                ))}
              </div>
              <article className="compose-preview">
                <header>
                  <b>
                    <Video />
                    {resultVideo?.url ? "合并成片预览" : "待合并顺序预览"}
                  </b>
                  {!resultVideo?.url && composePreviewSource && (
                    <span>
                      {orderedSources.findIndex((source) => source.id === composePreviewSource.id) + 1}/
                      {orderedSources.length} · {composePreviewSource.name}
                    </span>
                  )}
                </header>
                <div>
                  {resultVideo?.url ? (
                    <AuthenticatedMedia url={resultVideo.url} mimeType={resultVideo.mimeType} alt={resultVideo.name} />
                  ) : composePreviewSource ? (
                    <AuthenticatedMedia
                      key={selectedComposeAssetId}
                      url={selectedComposeVersion?.url ?? `/api/assets/${selectedComposeAssetId}/content`}
                      mimeType={selectedComposeVersion?.mimeType ?? "video/mp4"}
                      alt={`${composePreviewSource.name}待合并版本`}
                      loadingText="正在载入待合并视频…"
                      errorText="待合并视频预览失败"
                    />
                  ) : (
                    <>
                      <Video />
                      <p>暂无可预览的视频</p>
                    </>
                  )}
                </div>
                <footer>
                  <button onClick={() => setStage(3)}>返回分镜</button>
                  <button
                    className="primary"
                    disabled={composeOrder.length < 2 || Boolean(activeComposeJobId)}
                    onClick={() => void startCompose()}
                  >
                    {activeComposeJobId ? <LoaderCircle className="animate-spin" /> : <Video />}
                    {activeComposeJobId ? composeJob?.stage || "正在合并" : resultVideo?.url ? "重新合并" : "开始合并"}
                  </button>
                </footer>
              </article>
            </div>
          )}
        </section>
      </div>
      {stage === 0 && (
        <button
          className="parse-button"
          disabled={!sources.length || !selectedProduct || parsing || Boolean(job)}
          onClick={() => void parse()}
        >
          <Sparkles />
          {parsing ? "解析中" : job ? "已提交解析" : "视频解析"}
        </button>
      )}
      <ProjectHistoryDrawer
        open={historyOpen}
        currentProjectId={job?.id}
        onClose={() => setHistoryOpen(false)}
        onContinue={async (detail) => {
          await saveCurrentProject();
          restoreProject(detail.rootJob.id === job?.id ? await fetchRemixProject(detail.rootJob.id) : detail);
        }}
        onRenamed={(projectId, title) => {
          if (job?.id !== projectId) return;
          setProjectName(title);
          setJob((current) => (current ? { ...current, title } : current));
        }}
      />
      <PromptToolModal
        tool={promptTool}
        sourceJobId={job?.id}
        sourceAssetId={sourceAssetId}
        prompt={prompt}
        fileName={fileName}
        onClose={() => setPromptTool(null)}
        onApply={applyPromptTool}
      />
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
