// biome-ignore-all lint/a11y/noStaticElementInteractions: Modal backdrops dismiss their dialogs.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Copy,
  FileText,
  History,
  ImageOff,
  LoaderCircle,
  Mic2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  TriangleAlert,
  Upload,
  Video,
  X,
} from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  composeRemixVideos,
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
import { DashedPickerTile } from "@/components/domain/dashed-picker-tile";
import { ImagePreview } from "@/components/domain/media-preview";
import { ProductImage } from "@/components/domain/product-image";
import { ProjectRecordDrawer, type ProjectRecordStatusTone } from "@/components/domain/project-record-drawer";
import { PromptWorkbench } from "@/components/domain/prompt-workbench";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { ApiJobResult, LibraryAsset, LibraryProduct } from "@/entities/types";
import type { CreationModelCapability } from "@/features/ai-creation/ai-creation-composer";
import { fetchPortraits, type Portrait } from "@/features/portrait-library/portrait-data";
import { PortraitPickerDialog } from "@/features/portrait-library/portrait-picker-dialog";
import { systemPortraitMedia } from "../../../shared/media/system-media";
import type { RemixPromptTool } from "../../../shared/video-remix/prompt-tools";
import {
  moveRemixSource,
  parseRemixAnalysisEntries,
  type RemixAnalysisEntry,
  remixMaxSources,
} from "../../../shared/video-remix/workflow";
import { resolveOptionalRemixVoice } from "./optional-voice";
import { PromptToolModal } from "./prompt-tool-modal";
import "./remix-project.css";

const stages = ["上传配置", "AI 解析", "提示词校对", "分镜校对", "合并成片"];
const remixModeOptions = [
  { value: "product", label: "含商品模式" },
  { value: "talking", label: "纯口播模式" },
] as const;

interface SelectedPortrait {
  key: string;
  reference: Portrait["reference"];
  name: string;
  profession: string;
  source_url: string;
  thumbnail_url: string;
  display_url: string;
  original_url: string;
  index?: number;
  description?: string;
  gender?: string;
  age?: number;
}

function toSelectedPortrait(portrait: Portrait): SelectedPortrait {
  return {
    key: portrait.key,
    reference: portrait.reference,
    name: portrait.name,
    profession: portrait.profession,
    source_url: portrait.source_url,
    thumbnail_url: portrait.thumbnail_url,
    display_url: portrait.display_url,
    original_url: portrait.original_url,
    ...(portrait.type === "general" ? { index: portrait.index } : {}),
    description: portrait.description,
    gender: portrait.gender,
    age: portrait.age,
  };
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
  references: AttachmentSelection[];
  /** Stable labels for the per-shot temporary reference library. */
  referenceLabels: Record<string, string>;
  expanded: boolean;
}

interface StoryboardReference {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  source: "product" | "portrait" | "attachment";
  label: string;
  assetId?: string;
  portraitReference?: Portrait["reference"];
  authenticated?: boolean;
}

interface ShotSubmissionSnapshot {
  jobId: string;
  prompt: string;
  references: StoryboardReference[];
  modelId: SeedanceModelId;
  ratio: string;
  resolution: string;
  duration: number;
}

interface PendingShotSubmission {
  request: {
    sourceJobId: string;
    sourceAssetId: string;
    prompt: string;
    modelId: SeedanceModelId;
    ratio: string;
    resolution: string;
    duration: number;
    references: Array<{ assetId: string; label: string }>;
    portraitReferences: Array<{ reference: Portrait["reference"]; label: string }>;
  };
  snapshot: Omit<ShotSubmissionSnapshot, "jobId">;
}

function submittedReferenceLabels(value?: string) {
  try {
    const parsed = JSON.parse(value || "[]") as Array<{ label?: unknown }>;
    return new Set(parsed.flatMap((item) => (typeof item.label === "string" ? [item.label] : [])));
  } catch {
    return new Set<string>();
  }
}

function PublicPreviewImage({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (failed)
    return (
      <span className="public-image-error" role="img" aria-label={`${alt}加载失败`}>
        <ImageOff />
      </span>
    );

  return <ImagePreview src={url} alt={alt} onImageError={() => setFailed(true)} />;
}

function WorkflowHeader({ stage, onHistory, onReset }: { stage: number; onHistory: () => void; onReset: () => void }) {
  return (
    <header className="remix-header">
      <div className="remix-brand">
        <Video />
        爆款二创
      </div>
      <ol className="remix-steps" aria-label="创作进度">
        {stages.map((label, index) => (
          <li
            key={label}
            className={index === stage ? "active" : index < stage ? "done" : ""}
            aria-current={index === stage ? "step" : undefined}
          >
            <i>{index < stage ? <Check /> : index + 1}</i>
            <span>{label}</span>
            {index < stages.length - 1 && <ChevronRight className="step-arrow" />}
          </li>
        ))}
      </ol>
      <div className="remix-header-actions">
        <Button className="remix-header-action shrink-0" variant="outline" size="sm" onClick={onHistory}>
          <History />
          生成记录
        </Button>
        <Button className="remix-header-action shrink-0" variant="ghost" size="sm" onClick={onReset}>
          <Plus />
          新建
        </Button>
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
  selectedPortraits,
  selectedProduct,
  selectedVoice,
  sources,
  sourcesLocked,
  onSelectAttachments,
  onRemoveSource,
  onPick,
  onRemovePortrait,
  onRemoveVoice,
}: {
  mode: "product" | "talking";
  setMode: (mode: "product" | "talking") => void;
  description: string;
  setDescription: (value: string) => void;
  projectName: string;
  setProjectName: (value: string) => void;
  selectedPortraits: SelectedPortrait[];
  selectedProduct: LibraryProduct | null;
  selectedVoice: LibraryAsset | null;
  sources: AttachmentSelection[];
  sourcesLocked: boolean;
  onSelectAttachments: (assets: AttachmentSelection[]) => void;
  onRemoveSource: (assetId: string) => void;
  onPick: (kind: "product" | "portrait" | "voice") => void;
  onRemovePortrait: (key: string) => void;
  onRemoveVoice: () => void;
}) {
  return (
    <aside className="remix-config">
      <SegmentedControl
        ariaLabel="创作模式"
        value={mode}
        options={remixModeOptions}
        onValueChange={setMode}
        fullWidth
      />
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
      </div>
      <DashedPickerTile
        presentation="wide"
        title={selectedProduct?.name || "未选择商品"}
        description={selectedProduct ? `${selectedProduct.images.length} 张商品图` : undefined}
        icon={<Plus />}
        preview={
          selectedProduct ? (
            <ProductImage
              url={selectedProduct.images[0]?.url || ""}
              originalUrl={selectedProduct.images[0]?.originalUrl}
              mimeType={selectedProduct.images[0]?.mimeType || "image/png"}
              alt={selectedProduct.name}
            />
          ) : undefined
        }
        aria-label={selectedProduct ? "更换商品" : "选择商品"}
        onClick={() => onPick("product")}
      />
      <div className="config-field-title">
        <b>人像</b>
      </div>
      <div className="portrait-cards-row">
        {selectedPortraits.map((portrait) => (
          <div className="remix-portrait-card" key={portrait.key}>
            <ImagePreview className="config-portrait" src={portrait.thumbnail_url} alt={portrait.name} />
            <Button
              type="button"
              className="portrait-card-remove"
              variant="ghost"
              aria-label={`移除人像 ${portrait.name}`}
              onClick={() => onRemovePortrait(portrait.key)}
            >
              <X />
            </Button>
          </div>
        ))}
        <DashedPickerTile
          title={selectedPortraits.length ? "更换" : "添加"}
          icon={<Plus />}
          aria-label={selectedPortraits.length ? "更换人像" : "添加人像"}
          onClick={() => onPick("portrait")}
        />
      </div>
      <div className="config-field-title">
        <b>
          口播音色 <small>（选填）</small>
        </b>
        {selectedVoice && (
          <Button className="ml-auto" type="button" variant="ghost" size="sm" onClick={onRemoveVoice}>
            清除
          </Button>
        )}
      </div>
      <DashedPickerTile
        presentation="wide"
        title={selectedVoice?.name || "未选择音色"}
        description={selectedVoice?.description || "使用视频原声或从音色库选择"}
        icon={<Mic2 />}
        aria-label={selectedVoice ? "更换口播音色" : "选择口播音色"}
        onClick={() => onPick("voice")}
      />
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
        <small className="type-helper">（同一成片的连续片段）</small>
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
                      url={source.url || `/api/assets/${source.id}/content`}
                      originalUrl={source.originalUrl}
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`删除 ${source.name}`}
                      disabled={sourcesLocked}
                      onClick={() => onRemoveSource(source.id)}
                    >
                      <X />
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                className="append-video-button"
                variant="outline"
                onClick={open}
                disabled={sourcesLocked || sources.length >= remixMaxSources}
              >
                <Plus />
                {sourcesLocked
                  ? "解析后不可更换分镜"
                  : sources.length >= remixMaxSources
                    ? `最多 ${remixMaxSources} 条`
                    : "继续添加分镜视频"}
              </Button>
              <small className="type-helper video-selection-count">
                已选 {sources.length}/{remixMaxSources} 条
              </small>
            </div>
          ) : (
            <Button
              type="button"
              className="config-attachment-picker"
              variant="outline"
              disabled={sourcesLocked}
              onClick={open}
            >
              <Upload />
              <span>
                <b>选择分镜视频</b>
                <small className="type-helper">支持从素材库或本地多选，最多 {remixMaxSources} 条</small>
              </span>
            </Button>
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
          <h2 className="type-section-title text-ink">{title}</h2>
          <Button variant="ghost" size="icon-sm" aria-label="关闭" onClick={onClose}>
            <X />
          </Button>
        </header>
        <div className="remix-picker-grid">
          {data.map((asset) => (
            <Button key={asset.id} variant="ghost" onClick={() => onSelect(asset)}>
              <span className={kind}>
                {kind === "product" ? (
                  <AuthenticatedMedia url={asset.url} mimeType={asset.mimeType} alt={asset.name} previewable={false} />
                ) : (
                  <Mic2 />
                )}
              </span>
              <b>{asset.name}</b>
              <small className="type-helper">{asset.description || asset.originalName}</small>
            </Button>
          ))}
          {isLoading && <p>正在加载资产…</p>}
          {error && <p>{error instanceof Error ? error.message : "资产加载失败"}</p>}
          {!isLoading && !error && !data.length && (
            <p>资产库还是空的，请先上传一个{kind === "product" ? "商品" : "音色"}。</p>
          )}
        </div>
        <footer>
          <Button
            variant="outline"
            onClick={() => window.location.assign(kind === "product" ? "/assets/products" : "/assets/voices")}
          >
            <Upload />
            管理并上传{kind === "product" ? "商品" : "音色"}
          </Button>
        </footer>
      </aside>
    </div>
  );
}

function ProductPickerModal({
  current,
  onClose,
  onSelect,
}: {
  current: LibraryProduct | null;
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
    staleTime: 120_000,
  });
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [pendingId, setPendingId] = useState<string>(current?.id ?? "");

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const filtered = useMemo(() => {
    const keyword = appliedQuery.trim().toLowerCase();
    if (!keyword) return data;
    return data.filter(
      (product) =>
        product.name.toLowerCase().includes(keyword) || (product.description ?? "").toLowerCase().includes(keyword),
    );
  }, [data, appliedQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
  const pending = data.find((product) => product.id === pendingId);

  const doSearch = () => {
    setAppliedQuery(query.trim());
    setPage(1);
  };

  const doReset = () => {
    setQuery("");
    setAppliedQuery("");
    setPage(1);
  };

  const pageButtons = useMemo(() => {
    const buttons: number[] = [];
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, page + 2);
    for (let i = start; i <= end; i++) buttons.push(i);
    return buttons;
  }, [page, totalPages]);

  return (
    <div className="remix-picker-layer" role="presentation" onMouseDown={onClose}>
      <aside
        className="remix-picker product-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-label="选择商品"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2 className="type-section-title text-ink">选择商品</h2>
          <Button variant="ghost" size="icon-sm" aria-label="关闭" onClick={onClose}>
            <X />
          </Button>
        </header>
        <div className="product-picker-controls">
          <label>
            <Search />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") doSearch();
              }}
              placeholder="搜索商品名称或描述…"
            />
          </label>
          <Button className="product-search-button" variant="default" onClick={doSearch}>
            查询
          </Button>
          <Button className="product-reset-button" variant="outline" onClick={doReset}>
            重置
          </Button>
        </div>
        <div className="remix-picker-grid product-picker-grid">
          {paged.map((product) => {
            const isSelected = product.id === pendingId;
            return (
              <Button
                key={product.id}
                className={`h-auto min-h-0 w-full flex-col items-stretch justify-start gap-0 whitespace-normal ${isSelected ? "selected" : ""}`}
                variant="ghost"
                aria-pressed={isSelected}
                onClick={() => setPendingId(product.id)}
              >
                <span className="product">
                  <ProductImage
                    url={product.images[0]?.url || ""}
                    originalUrl={product.images[0]?.originalUrl}
                    mimeType={product.images[0]?.mimeType || "image/png"}
                    alt={product.name}
                  />
                  {isSelected && (
                    <i>
                      <CircleCheck /> 已选择
                    </i>
                  )}
                </span>
                <b>{product.name}</b>
                <small className="type-helper">
                  {product.images.length} 张商品图 · {product.description || "暂无形态描述"}
                </small>
              </Button>
            );
          })}
          {isLoading && <p>正在加载商品…</p>}
          {error && <p>{error instanceof Error ? error.message : "商品加载失败"}</p>}
          {!isLoading && !error && !filtered.length && (
            <p>{appliedQuery ? "没有匹配的商品，请调整搜索条件。" : "商品库还是空的，请先创建商品并上传图片。"}</p>
          )}
        </div>
        <footer className="product-picker-footer">
          <div>
            <span>共 {filtered.length.toLocaleString()} 个商品</span>
            <span className="product-page-size">
              每页
              <select
                aria-label="每页显示数量"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
              >
                <option value={12}>12</option>
                <option value={24}>24</option>
                <option value={48}>48</option>
              </select>
              个
            </span>
          </div>
          <div className="product-pagination">
            <Button
              variant="outline"
              aria-label="上一页"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft />
            </Button>
            {pageButtons[0] > 1 && (
              <>
                <Button variant="outline" onClick={() => setPage(1)}>
                  1
                </Button>
                {pageButtons[0] > 2 && <span className="page-ellipsis">…</span>}
              </>
            )}
            {pageButtons.map((p) => (
              <Button key={p} className={p === page ? "active" : ""} variant="outline" onClick={() => setPage(p)}>
                {p}
              </Button>
            ))}
            {pageButtons[pageButtons.length - 1] < totalPages && (
              <>
                {pageButtons[pageButtons.length - 1] < totalPages - 1 && <span className="page-ellipsis">…</span>}
                <Button variant="outline" onClick={() => setPage(totalPages)}>
                  {totalPages}
                </Button>
              </>
            )}
            <Button
              variant="outline"
              aria-label="下一页"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronRight />
            </Button>
          </div>
          <div className="product-footer-actions">
            <Button variant="outline" onClick={() => window.location.assign("/assets/products")}>
              <Upload />
              管理商品
            </Button>
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button
              variant="default"
              disabled={!pending}
              onClick={() => {
                if (pending) onSelect(pending);
              }}
            >
              确定
            </Button>
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

function remixProjectStatusTone(stage: RemixProjectSummary["currentStage"]): ProjectRecordStatusTone {
  if (stage === "failed") return "error";
  if (stage === "completed") return "success";
  if (stage === "upload") return "neutral";
  return "progress";
}

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
  return (
    <ProjectRecordDrawer
      open={open}
      queryKey="video-remix-project-records"
      currentProjectId={currentProjectId}
      statusOptions={Object.entries(remixProjectStageLabels).map(([value, label]) => ({ value, label }))}
      onClose={onClose}
      fetchPage={async ({ query, status, page, pageSize }) => {
        const data = await fetchRemixProjects({
          query,
          stage: status as RemixProjectSummary["currentStage"] | undefined,
          page,
          pageSize,
        });
        return {
          items: data.projects.map((project) => ({
            id: project.id,
            title: project.title,
            status: project.currentStage,
            statusLabel: remixProjectStageLabels[project.currentStage],
            statusTone: remixProjectStatusTone(project.currentStage),
            summary:
              project.currentStage === "storyboard"
                ? `${project.productName} · 分镜 ${project.generatedCount}/${project.sourceCount}`
                : project.productName,
            createdBy: project.createdBy,
            updatedAt: project.updatedAt,
          })),
          total: data.total,
          page: data.page,
          pageSize: data.pageSize,
        };
      }}
      onRename={async (item, title) => {
        await saveRemixProject(item.id, { title });
      }}
      onRenamed={onRenamed}
      onContinue={async (item) => onContinue(await fetchRemixProject(item.id))}
    />
  );
}

export function RemixProject() {
  const queryClient = useQueryClient();
  const lastSavedWorkspace = useRef("");
  const skipNextWorkspaceSave = useRef(false);
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
  const [submittedShotJobId, setSubmittedShotJobId] = useState("");
  const [pendingShotSubmission, setPendingShotSubmission] = useState<PendingShotSubmission | null>(null);
  const [submittedShotSnapshot, setSubmittedShotSnapshot] = useState<ShotSubmissionSnapshot | null>(null);
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
  const [selectedPortraits, setSelectedPortraits] = useState<SelectedPortrait[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<LibraryProduct | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<LibraryAsset | null>(null);
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
  const {
    data: portraitOptions = [],
    isLoading: portraitsLoading,
    error: portraitsError,
  } = useQuery({
    queryKey: ["portrait-library"],
    queryFn: fetchPortraits,
    staleTime: Infinity,
    enabled: picker === "portrait",
  });
  // 即使模型尚未通过可用性验证，也保留在校对工作台中展示；否则整个编辑器会被错误地替换成空态。
  // 提交按钮仍会根据 enabled 禁用，后端也会做最终校验。
  const videoModels = (creationCapabilities?.models ?? []).filter(
    (model): model is CreationModelCapability & { id: SeedanceModelId } => model.kind === "video",
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
        next[source.id] = {
          modelId: defaultVideoModel.id,
          ratio: defaultVideoModel.supportedRatios.includes("9:16")
            ? "9:16"
            : defaultVideoModel.supportedRatios[0] || "9:16",
          resolution: defaultVideoModel.supportedResolutions.includes("720p")
            ? "720p"
            : defaultVideoModel.supportedResolutions[0] || "720p",
          duration: defaultVideoModel.supportedDurations.includes(5) ? 5 : defaultVideoModel.supportedDurations[0] || 5,
          // 左侧商品与人像只初始化“参考素材库”，不会自动成为生成入参。
          references: [],
          referenceLabels: {},
          expanded: true,
        };
        changed = true;
      }
      return changed ? next : current;
    });
  }, [defaultVideoModel, sources]);

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
    if (skipNextWorkspaceSave.current) {
      skipNextWorkspaceSave.current = false;
      lastSavedWorkspace.current = serialized;
      return;
    }
    if (serialized === lastSavedWorkspace.current) return;
    const timer = window.setTimeout(() => {
      void saveRemixProject(job.id, { workspace })
        .then((updated) => {
          lastSavedWorkspace.current = serialized;
          setJob((current) => (current?.id === updated.id ? updated : current));
          void queryClient.invalidateQueries({ queryKey: ["video-remix-project-records"] });
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
      const availableVoice = selectedVoice
        ? resolveOptionalRemixVoice(
            selectedVoice,
            await queryClient.fetchQuery({
              queryKey: ["asset-library", "voice"],
              queryFn: () => fetchLibraryAssets("voice"),
            }),
          )
        : null;
      const removedUnavailableVoice = Boolean(selectedVoice && !availableVoice);
      if (removedUnavailableVoice) setSelectedVoice(null);
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
        voiceAsset: availableVoice
          ? {
              filename: availableVoice.originalName,
              objectKey: availableVoice.id,
              fileUrl: availableVoice.url,
              coverUrl: availableVoice.url,
              fileType: "AUDIO",
              durationSec: availableVoice.durationSec ?? null,
            }
          : null,
        portraitAssets: selectedPortraits.map((portrait) => {
          const assetId =
            portrait.reference.type === "custom"
              ? portrait.reference.assetId
              : (portrait.source_url.match(/\/([^/]+)\.png(?:\?|$)/)?.[1] ?? null);
          return {
            id: portrait.index ?? (portrait.reference.type === "custom" ? portrait.reference.assetId : null),
            reference: portrait.reference,
            assetName: portrait.name,
            fileInfo: [
              {
                fileUrl: portrait.source_url,
                coverUrl: portrait.source_url,
                fileType: "IMAGE" as const,
                assetId,
              },
            ],
            description: portrait.description ?? "",
            gender: portrait.gender ?? "",
            age: portrait.age,
            occupation: portrait.profession,
          };
        }),
      });
      setJob(created);
      setComposeOrder(sources.map((source) => source.id));
      setComposePreviewId(sources[0]?.id || "");
      setActiveSourceId(sources[0]?.id || "");
      if (removedUnavailableVoice) setNotice("所选音色已删除，已按无音色继续分析");
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
    setSubmittedShotJobId("");
    setPendingShotSubmission(null);
    setSubmittedShotSnapshot(null);
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
        originalUrl: `/api/assets/${file.objectKey}/content`,
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
            originalUrl: `/api/assets/${image.metaId}/content`,
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
      const restoredPortraits: SelectedPortrait[] = [];
      for (const portrait of request.portraitAssets ?? []) {
        const portraitFile = portrait.fileInfo[0];
        if (!portraitFile) continue;
        const portraitId = portrait.reference?.portraitId ?? (Number(portrait.id) || 0);
        const generalMedia = portrait.reference?.type === "custom" ? undefined : systemPortraitMedia(portraitId);
        restoredPortraits.push({
          key: portrait.reference?.type === "custom" ? `custom:${portrait.reference.assetId}` : `general:${portraitId}`,
          reference: portrait.reference ?? { type: "general", portraitId: Number(portrait.id) || 0 },
          name: portrait.assetName,
          profession: portrait.occupation || "",
          source_url: portraitFile.fileUrl,
          thumbnail_url: generalMedia?.thumbnailUrl ?? portraitFile.fileUrl,
          display_url: generalMedia?.url ?? portraitFile.fileUrl,
          original_url: generalMedia?.originalUrl ?? portraitFile.fileUrl,
          ...(portrait.reference?.type === "custom" ? {} : { index: Number(portrait.id) || 0 }),
          description: portrait.description ?? undefined,
          gender: portrait.gender ?? undefined,
          age: portrait.age ?? undefined,
        });
      }
      setSelectedPortraits(restoredPortraits);
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
              originalUrl: `/api/assets/${voice.objectKey}/content`,
              createdAt: detail.rootJob.createdAt,
            }
          : null,
      );
      const rootReady = detail.rootJob.status === "succeeded" || detail.rootJob.status === "partially_succeeded";
      const shotHistory = detail.childJobs.filter((child) => child.values.workflowPhase === "shot-generation");
      const latestCompose = detail.childJobs.find((child) => child.values.workflowPhase === "compose") ?? null;
      skipNextWorkspaceSave.current = true;
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
      setPendingShotSubmission(null);
      setSubmittedShotSnapshot(null);
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
    <Button
      key={version.id}
      className={version.id === activePromptVersionId ? "active" : ""}
      variant="outline"
      onClick={() => {
        setPrompt(version.prompt);
        setActivePromptVersionId(version.id);
        setEditing(false);
      }}
    >
      <b>v{version.sequence}</b>
      <small className="type-helper">{version.label}</small>
      {version.id === activePromptVersionId && <Check />}
    </Button>
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
  useEffect(() => {
    if (!submittedShotJobId) return;
    const submitted = shotJobs.find((shotJob) => shotJob.id === submittedShotJobId);
    if (!submitted || submitted.status === "queued" || submitted.status === "processing") return;
    setSubmittedShotJobId("");
    if (submitted.status === "succeeded") {
      setStage(4);
      return;
    }
    if (submitted.status === "failed") {
      setSubmittedShotSnapshot(null);
      setNotice(submitted.error?.message || "分镜视频生成失败");
    }
  }, [shotJobs, submittedShotJobId]);
  const referenceLibraryKeys = useMemo(
    () => [
      ...(selectedProduct?.images ?? []).map((image) => `product:${image.id}`),
      ...selectedPortraits.map((portrait) => `portrait:${portrait.key}`),
      ...(activeDraft?.references ?? [])
        .filter((reference) => reference.mimeType.startsWith("image/"))
        .map((reference) => `attachment:${reference.id}`),
    ],
    [activeDraft?.references, selectedPortraits, selectedProduct],
  );
  useEffect(() => {
    if (!sourceAssetId || !referenceLibraryKeys.length) return;
    setShotDrafts((current) => {
      const draft = current[sourceAssetId];
      if (!draft) return current;
      const labels = { ...draft.referenceLabels };
      let nextNumber = Math.max(
        0,
        ...Object.values(labels).flatMap((label) => {
          const match = /^Image(\d+)$/.exec(label);
          return match ? [Number(match[1])] : [];
        }),
      );
      let changed = false;
      for (const id of referenceLibraryKeys) {
        if (labels[id]) continue;
        nextNumber += 1;
        labels[id] = `Image${nextNumber}`;
        changed = true;
      }
      return changed ? { ...current, [sourceAssetId]: { ...draft, referenceLabels: labels } } : current;
    });
  }, [referenceLibraryKeys, sourceAssetId]);
  const storyboardReferenceImages = useMemo<StoryboardReference[]>(() => {
    const labelFor = (id: string, fallback: number) => activeDraft?.referenceLabels[id] || `Image${fallback}`;
    const images = [
      ...(selectedProduct?.images ?? []).map((image) => ({
        id: `product:${image.id}`,
        name: image.name,
        url: image.url || "",
        mimeType: image.mimeType,
        source: "product" as const,
        assetId: image.id,
      })),
      ...selectedPortraits.map((portrait) => ({
        id: `portrait:${portrait.key}`,
        name: portrait.name,
        url: portrait.display_url,
        mimeType: "image/*",
        source: "portrait" as const,
        portraitReference: portrait.reference,
        authenticated: portrait.reference.type === "custom",
      })),
      ...(activeDraft?.references ?? [])
        .filter((reference) => reference.mimeType.startsWith("image/"))
        .map((reference) => ({
          id: `attachment:${reference.id}`,
          name: reference.name,
          url: reference.url || "",
          mimeType: reference.mimeType,
          source: "attachment" as const,
          assetId: reference.id,
        })),
    ];
    return [...new Map(images.map((image) => [image.id, image])).values()].map((image, index) => ({
      ...image,
      label: labelFor(image.id, index + 1),
    }));
  }, [activeDraft?.references, activeDraft?.referenceLabels, selectedPortraits, selectedProduct]);
  const patchShotDraft = (update: Partial<ShotGenerationDraft>) => {
    if (!sourceAssetId || !activeDraft) return;
    setShotDrafts((current) => ({
      ...current,
      [sourceAssetId]: { ...current[sourceAssetId], ...update },
    }));
  };
  const appendShotReferences = (assets: AttachmentSelection[]) => {
    if (!activeDraft) return;
    const known = new Set(activeDraft.references.map((asset) => asset.id));
    patchShotDraft({ references: [...activeDraft.references, ...assets.filter((asset) => !known.has(asset.id))] });
  };
  const executionSnapshot = useMemo<ShotSubmissionSnapshot | null>(() => {
    if (!activeShotRunning) return null;
    if (submittedShotSnapshot?.jobId === activeShotRunning.id) return submittedShotSnapshot;
    const labels = submittedReferenceLabels(activeShotRunning.values.referenceBindings);
    const taskPrompt = activeShotRunning.values.prompt || prompt;
    return {
      jobId: activeShotRunning.id,
      prompt: taskPrompt,
      references: storyboardReferenceImages.filter((reference) => labels.has(reference.label)),
      modelId: (activeShotRunning.values.modelId ||
        activeShotRunning.videoModel ||
        activeDraft?.modelId) as SeedanceModelId,
      ratio: activeShotRunning.values.ratio || activeDraft?.ratio || "9:16",
      resolution: activeShotRunning.values.resolution || activeDraft?.resolution || "720p",
      duration: Number(activeShotRunning.values.duration || activeDraft?.duration || 5),
    };
  }, [activeDraft, activeShotRunning, prompt, storyboardReferenceImages, submittedShotSnapshot]);
  const visibleExecutionSnapshot = executionSnapshot ?? submittedShotSnapshot;
  const prepareShotSubmission = () => {
    if (!job?.id || !sourceAssetId || !activeDraft || activeShotRunning) return;
    if (prompt.trim().length < 20) {
      setNotice("分镜生成提示词至少需要 20 个字符");
      return;
    }
    const mentionedLabels = new Set(prompt.match(/@Image\d+/g)?.map((token) => token.slice(1)) ?? []);
    const unresolved = [...mentionedLabels].find(
      (label) => !storyboardReferenceImages.some((reference) => reference.label === label),
    );
    if (unresolved) {
      setNotice(`@${unresolved} 未绑定到当前参考素材库`);
      return;
    }
    const quotedReferences = storyboardReferenceImages.filter((reference) => mentionedLabels.has(reference.label));
    if (quotedReferences.length > 9) {
      setNotice("当前模型单次最多可引用 9 张图片，请减少提示词中的 @ 引用");
      return;
    }
    setPendingShotSubmission({
      request: {
        sourceJobId: job.id,
        sourceAssetId,
        prompt,
        modelId: activeDraft.modelId,
        ratio: activeDraft.ratio,
        resolution: activeDraft.resolution,
        duration: activeDraft.duration,
        references: quotedReferences.flatMap((reference) =>
          reference.assetId ? [{ assetId: reference.assetId, label: reference.label }] : [],
        ),
        portraitReferences: quotedReferences.flatMap((reference) =>
          reference.portraitReference ? [{ reference: reference.portraitReference, label: reference.label }] : [],
        ),
      },
      snapshot: {
        prompt,
        references: quotedReferences,
        modelId: activeDraft.modelId,
        ratio: activeDraft.ratio,
        resolution: activeDraft.resolution,
        duration: activeDraft.duration,
      },
    });
  };
  const submitShotGeneration = async () => {
    const submission = pendingShotSubmission;
    if (!submission) return;
    setPendingShotSubmission(null);
    setNotice("");
    try {
      const created = await generateRemixShot(submission.request);
      setSubmittedShotJobId(created.id);
      setSubmittedShotSnapshot({ ...submission.snapshot, jobId: created.id });
      setShotSelectionTouched((current) => ({ ...current, [submission.request.sourceAssetId]: false }));
      setNotice("分镜视频已提交生成，完成后将自动进入合并成片");
      await refetchShotJobs();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "分镜生成任务提交失败");
    }
  };
  const orderedSources = composeOrder
    .map((assetId) => sources.find((source) => source.id === assetId))
    .filter((source): source is AttachmentSelection => Boolean(source));
  const composeReadyCount = orderedSources.filter((source) =>
    Boolean(selectedShotAssets[source.id] && selectedShotAssets[source.id] !== source.id),
  ).length;
  const composePreviewSource =
    orderedSources.find((source) => source.id === composePreviewId) ?? orderedSources[0] ?? sources[0];
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
      <WorkflowHeader stage={stage} onHistory={() => setHistoryOpen(true)} onReset={() => void startNewProject()} />
      <div className="remix-body">
        <ConfigSidebar
          mode={mode}
          setMode={setMode}
          description={description}
          setDescription={setDescription}
          projectName={projectName}
          setProjectName={setProjectName}
          selectedPortraits={selectedPortraits}
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
          onRemovePortrait={(key) =>
            setSelectedPortraits((current) => current.filter((portrait) => portrait.key !== key))
          }
          onRemoveVoice={() => setSelectedVoice(null)}
        />
        <section className="remix-workspace">
          {notice && (
            <Button className="remix-toast" variant="ghost" onClick={() => setNotice("")}>
              <Sparkles />
              {notice}
              <X />
            </Button>
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
              <h2 className="type-section-title">{parsing ? "AI 正在解析分镜视频" : "等待开始 AI 解析"}</h2>
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
                  <Button
                    key={source.id}
                    className={source.id === activeSourceId ? "active" : ""}
                    variant="outline"
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
                        previewable={false}
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
                  </Button>
                );
              })}
            </div>
          )}
          {stage === 2 && (
            <div className="prompt-stage">
              <div className="prompt-toolbar">
                <label>
                  对比版本{" "}
                  <Button
                    className={`toggle ${compare ? "active" : ""}`}
                    variant="ghost"
                    aria-label="切换版本对比"
                    onClick={() => setCompare(!compare)}
                  />
                </label>
                <div>
                  <Button variant="default" disabled={!prompt} onClick={() => setPromptTool("check")}>
                    <CircleCheck />
                    智能检查
                  </Button>
                  <Button
                    variant="default"
                    className="purple"
                    disabled={!prompt}
                    onClick={() => setPromptTool("modify")}
                  >
                    <Pencil />
                    智能修改
                  </Button>
                  <Button
                    variant="default"
                    className="orange"
                    disabled={!prompt}
                    onClick={() => setPromptTool("voice")}
                  >
                    <Mic2 />
                    换口播
                  </Button>
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
                  <Button variant="outline" onClick={() => setEditing(!editing)}>
                    <FileText />
                    {editing ? "保存文本" : "编辑文本"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void navigator.clipboard.writeText(prompt).then(() => setNotice("脚本已复制"))}
                  >
                    <Copy />
                    复制脚本
                  </Button>
                </div>
                <Button variant="default" className="primary" onClick={next}>
                  下一步
                </Button>
              </footer>
            </div>
          )}
          {stage === 3 && (
            <div className="storyboard-proof">
              {visibleExecutionSnapshot ? (
                <section className="shot-execution-panel" aria-label="分镜视频生成任务">
                  <header>
                    <span>
                      <Video />
                      结果预览
                    </span>
                    <small className="type-helper">{activeShotRunning?.stage || "正在生成当前分镜"}</small>
                  </header>
                  <div className="shot-execution-content">
                    <div className="shot-execution-preview" role="status" aria-live="polite">
                      <LoaderCircle className="animate-spin" />
                      <p>
                        正在生成视频，预计耗时约 4–5 分钟，
                        <br />
                        请耐心等待
                      </p>
                    </div>
                    <div className="shot-execution-details">
                      <section>
                        <b>引用素材库</b>
                        <div className="submitted-reference-list">
                          {visibleExecutionSnapshot.references.map((reference) => (
                            <span key={reference.id} title={`@${reference.label} · ${reference.name}`}>
                              {reference.source === "portrait" && !reference.authenticated ? (
                                <PublicPreviewImage url={reference.url} alt={reference.name} />
                              ) : (
                                <AuthenticatedMedia
                                  url={reference.url}
                                  mimeType={reference.mimeType}
                                  alt={reference.name}
                                  previewable={false}
                                  loadingText=""
                                  errorText="图片加载失败"
                                />
                              )}
                              <small className="type-helper">@{reference.label}</small>
                            </span>
                          ))}
                          {!visibleExecutionSnapshot.references.length && <i>本次未引用素材</i>}
                        </div>
                      </section>
                      <section>
                        <b>已提交提示词</b>
                        <pre>{visibleExecutionSnapshot.prompt}</pre>
                      </section>
                      <section className="submitted-model-settings">
                        <b>生成参数</b>
                        <span>
                          {videoModels.find((model) => model.id === visibleExecutionSnapshot.modelId)?.displayName ||
                            visibleExecutionSnapshot.modelId}
                        </span>
                        <span>{visibleExecutionSnapshot.ratio}</span>
                        <span>{visibleExecutionSnapshot.resolution}</span>
                        <span>{visibleExecutionSnapshot.duration}秒</span>
                      </section>
                    </div>
                  </div>
                </section>
              ) : activeDraft ? (
                <div className="storyboard-editor">
                  <div className="storyboard-reference-cluster">
                    {storyboardReferenceImages.map((reference, index) => (
                      <span
                        className="storyboard-reference-image"
                        key={reference.id}
                        title={reference.name}
                        style={{ "--reference-index": index } as CSSProperties}
                      >
                        {reference.source === "portrait" && !reference.authenticated ? (
                          <PublicPreviewImage url={reference.url} alt={reference.name} />
                        ) : (
                          <AuthenticatedMedia
                            url={reference.url}
                            mimeType={reference.mimeType}
                            alt={reference.name}
                            previewable={false}
                            loadingText=""
                            errorText="图片加载失败"
                          />
                        )}
                      </span>
                    ))}
                    <AttachmentPicker
                      accept="image/*"
                      multiple
                      trigger={(open) => (
                        <Button
                          type="button"
                          className="storyboard-add-reference"
                          variant="ghost"
                          aria-label="添加参考素材"
                          style={{ "--reference-index": storyboardReferenceImages.length } as CSSProperties}
                          onClick={open}
                        >
                          <Plus />
                        </Button>
                      )}
                      onSelect={appendShotReferences}
                    />
                  </div>
                  <PromptWorkbench
                    embedded
                    expanded={activeDraft.expanded}
                    references={[]}
                    lockedReferenceIds={[]}
                    prompt={prompt}
                    placeholder="描述当前镜头的动作、主体、场景与运镜"
                    inputLabel="当前分镜生成提示词"
                    mentions={storyboardReferenceImages.map((reference) => ({
                      id: reference.id,
                      label: reference.label,
                      name: reference.name,
                    }))}
                    accept="image/*"
                    multiple
                    submitting={Boolean(activeShotRunning)}
                    submitLabel="生成视频"
                    onChooseAssets={appendShotReferences}
                    onRemoveReference={(id) =>
                      patchShotDraft({ references: activeDraft.references.filter((reference) => reference.id !== id) })
                    }
                    onPromptChange={(value) => {
                      setPrompt(value);
                      setActivePromptVersionId("");
                    }}
                    onExpandedChange={(expanded) => patchShotDraft({ expanded })}
                    onSubmit={prepareShotSubmission}
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
                            });
                          }}
                        >
                          {videoModels.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.displayName}
                              {model.enabled ? "" : "（未验证）"}
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
                </div>
              ) : null}
              {!visibleExecutionSnapshot && !activeDraft && (
                <div className="shot-generation-unavailable">当前没有已启用的视频生成模型</div>
              )}
            </div>
          )}
          {stage === 4 && (
            <div className="compose-stage">
              <section className="compose-timeline-panel" aria-label="成片时间线">
                <div className="compose-top">
                  <div>
                    <b>成片时间线</b>
                    <span>拖拽片段调整顺序</span>
                  </div>
                  <i>
                    {composeReadyCount}/{sources.length} 片段就绪
                  </i>
                </div>
                <div className="timeline">
                  {orderedSources.map((source, index) => {
                    const isReady = Boolean(
                      selectedShotAssets[source.id] && selectedShotAssets[source.id] !== source.id,
                    );
                    return (
                      <article
                        key={source.id}
                        className={`${source.id === composePreviewSource?.id ? "active " : ""}${isReady ? "ready" : "missing"}`}
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
                        <Button
                          type="button"
                          className="timeline-preview-button"
                          variant="default"
                          aria-label={`预览第 ${index + 1} 个片段：${source.name}`}
                          onClick={() => setComposePreviewId(source.id)}
                        >
                          {isReady ? (
                            <AuthenticatedMedia
                              url={`/api/assets/${selectedShotAssets[source.id]}/content`}
                              mimeType="video/mp4"
                              alt={`${source.name}生成版本`}
                              controls={false}
                              previewable={false}
                              loadingText="载入中…"
                              errorText="预览失败"
                            />
                          ) : (
                            <span className="timeline-missing-state">
                              <TriangleAlert />
                              <small className="type-helper">未生成</small>
                            </span>
                          )}
                          <b>{index + 1}</b>
                        </Button>
                        <footer>
                          <span title={source.name}>{source.name}</span>
                          <small className={isReady ? "type-helper ready" : "type-helper missing"}>
                            {isReady ? "就绪" : "缺失"}
                          </small>
                        </footer>
                      </article>
                    );
                  })}
                </div>
              </section>
              <article className="compose-preview">
                <header>
                  <b>
                    <Video />
                    成片预览
                  </b>
                </header>
                <div className="compose-preview-body">
                  {resultVideo?.url ? (
                    <AuthenticatedMedia url={resultVideo.url} mimeType={resultVideo.mimeType} alt={resultVideo.name} />
                  ) : activeComposeJobId ? (
                    <>
                      <LoaderCircle className="animate-spin" />
                      <p>{composeJob?.stage || "正在合并成片，请耐心等待"}</p>
                    </>
                  ) : (
                    <>
                      <Video />
                      <p>点击下方「开始合并」生成成片</p>
                    </>
                  )}
                </div>
                <footer>
                  <span className="compose-warning">
                    {composeReadyCount < sources.length && <TriangleAlert />}
                    {composeReadyCount < sources.length
                      ? "有片段未生成，仍可合并已就绪片段"
                      : "全部片段已生成，可以开始合并"}
                  </span>
                  <div>
                    <Button variant="outline" onClick={() => setStage(3)}>
                      返回分镜
                    </Button>
                    <Button
                      className="primary"
                      variant="default"
                      disabled={composeOrder.length < 2 || Boolean(activeComposeJobId)}
                      onClick={() => void startCompose()}
                    >
                      {activeComposeJobId ? <LoaderCircle className="animate-spin" /> : <Video />}
                      {activeComposeJobId
                        ? composeJob?.stage || "正在合并"
                        : resultVideo?.url
                          ? "重新合并"
                          : "开始合并"}
                    </Button>
                  </div>
                </footer>
              </article>
            </div>
          )}
        </section>
      </div>
      {stage === 0 && (
        <Button
          className="parse-button"
          variant="default"
          disabled={!sources.length || !selectedProduct || parsing || Boolean(job)}
          onClick={() => void parse()}
        >
          <Sparkles />
          {parsing ? "解析中" : job ? "已提交解析" : "视频解析"}
        </Button>
      )}
      {pendingShotSubmission && (
        <div
          className="remix-picker-layer shot-submit-confirm-layer"
          role="presentation"
          onMouseDown={() => setPendingShotSubmission(null)}
        >
          <section
            className="shot-submit-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shot-submit-confirm-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <Video />
              <h2 className="type-section-title" id="shot-submit-confirm-title">
                确认提交视频生成任务
              </h2>
            </header>
            <p>任务提交后不可取消、不可停止。</p>
            <small className="type-helper">请确认提示词、引用素材和生成参数无误后再继续。</small>
            <footer>
              <Button type="button" variant="outline" onClick={() => setPendingShotSubmission(null)}>
                返回修改
              </Button>
              <Button type="button" className="primary" variant="default" onClick={() => void submitShotGeneration()}>
                确认提交
              </Button>
            </footer>
          </section>
        </div>
      )}
      <ProjectHistoryDrawer
        open={historyOpen}
        currentProjectId={job?.id}
        onClose={() => setHistoryOpen(false)}
        onContinue={(detail) => restoreProject(detail)}
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
          current={selectedProduct}
          onClose={() => setPicker(null)}
          onSelect={(product) => {
            setSelectedProduct(product);
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
            setPicker(null);
          }}
        />
      )}
      {picker === "portrait" && (
        <PortraitPickerDialog
          open
          portraits={portraitOptions}
          loading={portraitsLoading}
          error={portraitsError}
          selectedKeys={selectedPortraits.map((portrait) => portrait.key)}
          maxSelect={3}
          onClose={() => setPicker(null)}
          onConfirm={(portraits) => {
            setSelectedPortraits(portraits.map(toSelectedPortrait));
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}
