// biome-ignore-all lint/a11y/useButtonType: This workbench does not use native form submission.
// biome-ignore-all lint/a11y/noStaticElementInteractions: Modal backdrops dismiss their dialogs.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Captions,
  Check,
  ChevronDown,
  Copy,
  Download,
  Film,
  FolderOpen,
  History,
  LoaderCircle,
  Mic,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Upload,
  Video,
  WandSparkles,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  batchGenerateVideoCreateShotVideos,
  createVideoCreate,
  downloadAuthenticated,
  fetchVideoCreateProject,
  fetchVideoCreateProjects,
  generateVideoCreateShotVideo,
  regenerateVideoCreateScriptSection,
  replaceVideoCreateShotVideo,
  runVideoCreateProjectAction,
  saveVideoCreateScriptSection,
  updateAllVideoCreateShotOptions,
  updateVideoCreate,
  updateVideoCreateShotOptions,
} from "@/api/api-client";
import type { VideoCreateInput, VideoCreateProject } from "@/api/generated/types.gen";
import { AttachmentPicker, type AttachmentSelection } from "@/components/domain/attachment-picker";
import { AuthenticatedMedia } from "@/components/domain/authenticated-media";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { fetchPortraits } from "@/features/portrait-library/portrait-data";
import { PortraitPickerDialog } from "@/features/portrait-library/portrait-picker-dialog";
import { cn } from "@/lib/utils";
import { videoCreateActionAvailability } from "./video-create-actions";

const scenes = ["商城转化", "短视频带货", "引流直播间", "直播带货", "内容种草", "品牌曝光", "本地到店", "线索收集"];
const durationOptions = [15, 30, 60, 180];
const marketingGoals = ["电商转化", "品牌曝光", "App下载", "门店到店", "直播引流"];
const targetAudiences = [
  "18-24岁女性",
  "25-35岁女性",
  "18-24岁男性",
  "25-35岁男性",
  "宝妈",
  "学生",
  "职场白领",
  "中老年",
  "全年龄段",
];
const presenterRoles = ["好物推荐员", "普通用户", "行业专家", "品牌官方"];
const presenterGenders = ["不区分", "男声", "女声"];
const contentStyles = ["种草", "专业测评", "情绪共鸣", "悬念叙事", "故事", "数据说话"];
const openingStyles = ["自动匹配", "痛点直击", "数字冲击", "福利诱惑", "问句互动", "品牌声量", "随机"];
const closingGuides = ["硬引导购买", "软种草", "互动提问"];
const scriptTopics = ["直播带货", "产品功能讲解", "痛点解决", "对比测评", "情感共鸣", "节日营销"];
const materialTopics = [
  "产品外观",
  "使用体验",
  "价格优势",
  "品质保障",
  "售后服务",
  "用户口碑",
  "生活方式",
  "成分功效",
  "限时优惠",
];
const marketingMethods = ["场景展示", "痛点解决", "竞品对比", "用户证言", "专家背书", "限时促销"];
const templates = ["常规", "节日营销", "明星同款", "爆款复制"];
const videoModelOptions: Array<{
  id: NonNullable<VideoCreateInput["videoModel"]>;
  name: string;
  description: string;
  tag: string;
}> = [
  {
    id: "doubao-seedance-2-0-260128",
    name: "Seedance 2.0",
    description: "音视图文均可参考，强调参考一致性和视听稳定性",
    tag: "多模态参考",
  },
  {
    id: "doubao-seedance-2-0-mini-260615",
    name: "Seedance 2.0 Mini",
    description: "新一代高性价比视频生成模型",
    tag: "模型上新",
  },
  {
    id: "doubao-seedance-2-0-fast-260128",
    name: "Seedance 2.0 Fast",
    description: "生成速度更快，继承 Seedance 2.0 核心优势",
    tag: "速度更快",
  },
];
const statusLabels: Record<string, string> = {
  draft: "草稿",
  analyzing: "AI 分析中",
  script_generating: "脚本生成中",
  script_review: "待审核脚本",
  storyboard_generating: "分镜生成中",
  storyboard_review: "分镜制作中",
  composing: "视频合并中",
  completed: "已完成",
  failed: "生成失败",
};
type MultiSelectKey =
  | "marketingGoals"
  | "targetAudiences"
  | "presenterRoles"
  | "presenterGenders"
  | "contentStyles"
  | "openingStyles"
  | "closingGuides"
  | "scriptTopics"
  | "materialTopics"
  | "marketingMethods"
  | "templates";

const defaultInput: VideoCreateInput = {
  productAssetIds: [],
  scene: "内容种草",
  productName: "",
  sellingPoints: [],
  durationSec: 15,
  segmentCount: 3,
  speechRate: "medium",
  requirements: "",
  scriptStyle: "自然种草",
  marketingGoals: [],
  targetAudiences: [],
  audiencePainPoints: "",
  productBenefits: "",
  presenterRoles: [],
  presenterGenders: [],
  contentStyles: [],
  openingStyles: [],
  closingGuides: [],
  scriptTopics: [],
  materialTopics: [],
  marketingMethods: [],
  templates: [],
  sensitiveWords: "",
  customRequirements: "",
  videoModel: "doubao-seedance-2-0-fast-260128",
  ratio: "9:16",
  subtitles: true,
  priority: "speech",
};

function errorMessage(error: unknown) {
  if (!(error instanceof Error)) return "操作失败，请稍后重试";
  try {
    const body = JSON.parse(error.message) as { error?: { message?: string } };
    return body.error?.message || error.message;
  } catch {
    return error.message;
  }
}

function estimateDuration(text: string, speechRate: VideoCreateInput["speechRate"]) {
  const charactersPerSecond = speechRate === "slow" ? 3 : speechRate === "fast" ? 5 : 4;
  return Math.max(1, Math.ceil([...text.replace(/\s/g, "")].length / charactersPerSecond));
}

function ChoiceGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: readonly string[];
  onToggle: (option: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            className={cn(
              "h-8 rounded-full px-3 font-normal",
              selected.includes(option) && "border-primary bg-primary text-white hover:bg-primary/90",
            )}
            variant="outline"
            size="sm"
            aria-pressed={selected.includes(option)}
            key={option}
            onClick={() => onToggle(option)}
          >
            {selected.includes(option) && <Check />}
            {option}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ParameterPanel({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <Button
        className="h-10 w-full justify-between rounded-none px-3 hover:bg-surface-muted"
        variant="ghost"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="flex items-center gap-2">
          <span>{title}</span>
          {count > 0 && <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-white">{count}</span>}
          <span className="text-xs font-normal text-muted">{count ? "已选" : "可选"}</span>
        </span>
        <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
      </Button>
      {open && <div className="grid gap-4 border-t border-line p-3">{children}</div>}
    </section>
  );
}

function ProductImages({
  assets,
  ids,
  onAdd,
  onRemove,
}: {
  assets: AttachmentSelection[];
  ids: string[];
  onAdd: (assets: AttachmentSelection[]) => void;
  onRemove: (id: string) => void;
}) {
  const visible = ids.map(
    (id) => assets.find((asset) => asset.id === id) ?? { id, name: "商品图片", mimeType: "image/png" },
  );
  return (
    <div className="flex flex-wrap gap-2">
      {visible.map((asset) => (
        <div
          className="relative h-20 w-16 overflow-hidden rounded-lg border border-line bg-surface-muted [&_img]:h-full [&_img]:w-full [&_img]:object-cover"
          key={asset.id}
        >
          <AuthenticatedMedia url={`/api/assets/${asset.id}/content`} mimeType={asset.mimeType} alt={asset.name} />
          <Button
            className="absolute right-1 top-1 size-6 rounded-full bg-ink/75 p-0 text-white hover:bg-ink"
            size="icon"
            aria-label="移除商品图片"
            onClick={() => onRemove(asset.id)}
          >
            <X />
          </Button>
        </div>
      ))}
      {ids.length < 6 && (
        <AttachmentPicker
          accept="image/*"
          multiple
          onSelect={onAdd}
          trigger={(open) => (
            <Button
              className="h-20 w-16 flex-col rounded-lg border-dashed px-0 text-muted"
              variant="outline"
              onClick={open}
            >
              <Plus />
              添加
            </Button>
          )}
        />
      )}
    </div>
  );
}

function HistoryDrawer({
  open,
  projects,
  onClose,
  onSelect,
}: {
  open: boolean;
  projects: VideoCreateProject[];
  onClose: () => void;
  onSelect: (project: VideoCreateProject) => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-ink/20" role="presentation" onMouseDown={onClose}>
      <aside
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-sm"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-line px-4">
          <h2 className="text-base font-medium text-ink">生成记录</h2>
          <Button variant="ghost" size="icon" aria-label="关闭生成记录" onClick={onClose}>
            <X />
          </Button>
        </header>
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {projects.map((item) => (
            <Button
              className="h-auto w-full justify-start rounded-lg p-3 text-left"
              variant="outline"
              key={item.project.id}
              onClick={() => onSelect(item)}
            >
              <span className="min-w-0 flex-1 space-y-1">
                <span className="flex items-center gap-2">
                  <span className="rounded-full bg-surface-strong px-2 py-0.5 text-xs text-body">
                    {statusLabels[item.project.status]}
                  </span>
                  <span className="truncate font-medium text-ink">{item.project.title}</span>
                </span>
                <span className="block truncate text-xs font-normal text-muted">
                  {item.project.input.productName || "尚未填写产品名称"}
                </span>
              </span>
              <time className="text-xs font-normal text-muted">
                {new Date(item.project.updatedAt).toLocaleString()}
              </time>
            </Button>
          ))}
          {!projects.length && <p className="py-10 text-center text-sm text-muted">暂无生成记录</p>}
        </div>
      </aside>
    </div>
  );
}

export function VideoCreatePage() {
  const queryClient = useQueryClient();
  const [input, setInput] = useState<VideoCreateInput>(defaultInput);
  const [project, setProject] = useState<VideoCreateProject | null>(null);
  const [productAssets, setProductAssets] = useState<AttachmentSelection[]>([]);
  const [tab, setTab] = useState<"script" | "storyboard">("script");
  const [openPanels, setOpenPanels] = useState({ requirements: false, style: false, advanced: false });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchSettings, setBatchSettings] = useState<{
    videoModel: NonNullable<VideoCreateInput["videoModel"]>;
    ratio: NonNullable<VideoCreateInput["ratio"]>;
    resolution: "480p" | "720p";
  }>({ videoModel: "doubao-seedance-2-0-fast-260128", ratio: "9:16", resolution: "720p" });
  const [portraitPickerOpen, setPortraitPickerOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const active = project?.project.status;
  const hasRunningShot = project?.shots.some((shot) => shot.status === "queued" || shot.status === "generating");
  const projectId = project?.project.id;
  const sellingPoints = input.sellingPoints ?? [];
  const hasScript = Boolean(project?.sections.length);
  const hasStoryboard = Boolean(project?.shots.length);
  const batchEligibleShots =
    project?.shots.filter((shot) => shot.status === "pending" || shot.status === "failed") ?? [];
  const actionAvailability = videoCreateActionAvailability({ hasScript, hasStoryboard });
  const polling =
    Boolean(active && ["analyzing", "script_generating", "storyboard_generating", "composing"].includes(active)) ||
    hasRunningShot;
  const { data: history = [] } = useQuery({
    queryKey: ["video-create-projects"],
    queryFn: fetchVideoCreateProjects,
    refetchInterval: polling ? 3_000 : false,
  });
  const { data: portraits = [], isLoading: portraitsLoading } = useQuery({
    queryKey: ["portrait-library"],
    queryFn: fetchPortraits,
    staleTime: Infinity,
  });
  const selectedPortrait = portraits.find((portrait) => portrait.index === input.portraitId);
  const { data: refreshed } = useQuery({
    queryKey: ["video-create-project", projectId],
    queryFn: () => fetchVideoCreateProject(projectId ?? ""),
    enabled: Boolean(projectId),
    refetchInterval: polling ? 2_000 : false,
  });
  useEffect(() => {
    if (!refreshed) return;
    setProject(refreshed);
    setInput(refreshed.project.input);
    if (refreshed.shots.length) setTab("storyboard");
    else if (refreshed.sections.length) setTab("script");
  }, [refreshed]);

  const mutateInput = <K extends keyof VideoCreateInput>(key: K, value: VideoCreateInput[K]) =>
    setInput((current) => ({ ...current, [key]: value }));
  const toggleOption = (key: MultiSelectKey, option: string) =>
    setInput((current) => {
      const selected = (current[key] ?? []) as readonly string[];
      return {
        ...current,
        [key]: selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option],
      } as VideoCreateInput;
    });
  const togglePanel = (key: keyof typeof openPanels) =>
    setOpenPanels((current) => ({ ...current, [key]: !current[key] }));
  const requirementCount = (input.marketingGoals?.length ?? 0) + (input.targetAudiences?.length ?? 0);
  const styleCount =
    (input.presenterRoles?.length ?? 0) +
    (input.presenterGenders?.length ?? 0) +
    (input.contentStyles?.length ?? 0) +
    (input.openingStyles?.length ?? 0) +
    (input.closingGuides?.length ?? 0);
  const advancedCount =
    (input.scriptTopics?.length ?? 0) +
    (input.materialTopics?.length ?? 0) +
    (input.marketingMethods?.length ?? 0) +
    (input.templates?.length ?? 0);
  const invalidate = (next?: VideoCreateProject) => {
    if (next) setProject(next);
    void queryClient.invalidateQueries({ queryKey: ["video-create-projects"] });
    if (next) void queryClient.invalidateQueries({ queryKey: ["video-create-project", next.project.id] });
  };
  const execute = async (key: string, task: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setNotice("");
    try {
      await task();
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy("");
    }
  };
  const persist = async () => {
    if (!input.productAssetIds.length) throw new Error("请先添加至少一张商品图片");
    if (!project) {
      const created = await createVideoCreate(input, input.productName || "一键成片新项目");
      invalidate(created);
      return created;
    }
    const updated = await updateVideoCreate(project, input);
    invalidate(updated);
    return updated;
  };
  const action = (name: "analyze" | "script" | "storyboard" | "compose") =>
    execute(name, async () => {
      const saved = name === "compose" && project ? project : await persist();
      await runVideoCreateProjectAction(saved.project.id, name);
      setProject({
        ...saved,
        project: {
          ...saved.project,
          status:
            name === "analyze"
              ? "analyzing"
              : name === "script"
                ? "script_generating"
                : name === "storyboard"
                  ? "storyboard_generating"
                  : "composing",
        },
      });
      if (name === "storyboard") setTab("storyboard");
      void queryClient.invalidateQueries({ queryKey: ["video-create-project", saved.project.id] });
    });
  const reset = () => {
    setProject(null);
    setInput(defaultInput);
    setProductAssets([]);
    setTab("script");
    setOpenPanels({ requirements: false, style: false, advanced: false });
    setNotice("");
    setDrafts({});
  };
  const totalCharacters = useMemo(
    () =>
      project?.sections.reduce(
        (total, section) => total + [...(drafts[section.id] ?? section.currentVersion?.text ?? "")].length,
        0,
      ) ?? 0,
    [drafts, project?.sections],
  );
  const totalDuration =
    project?.sections.reduce(
      (total, section) =>
        total + estimateDuration(drafts[section.id] ?? section.currentVersion?.text ?? "", input.speechRate),
      0,
    ) ?? 0;

  return (
    <div
      className="grid h-[calc(100vh-56px)] min-h-0 grid-cols-[360px_minmax(0,1fr)] overflow-hidden bg-surface text-sm text-body max-[1100px]:grid-cols-[320px_minmax(0,1fr)] max-[760px]:block max-[760px]:h-auto max-[760px]:overflow-auto"
      data-testid="video-create-page"
    >
      <aside
        className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-line bg-surface max-[760px]:min-h-[calc(100vh-56px)] max-[760px]:overflow-visible"
        data-testid="video-create-config-panel"
      >
        <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-line px-3">
          <h1 className="text-lg font-medium text-ink">新建项目</h1>
          <Button variant="ghost" size="sm" onClick={reset}>
            <Plus /> 新建
          </Button>
        </header>
        <div
          className="flex-1 space-y-4 overflow-y-auto p-3 max-[760px]:overflow-visible"
          data-testid="video-create-config-scroll"
        >
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>产品图片</Label>
              <span className="text-xs text-muted">最多 6 张</span>
            </div>
            <ProductImages
              assets={productAssets}
              ids={input.productAssetIds}
              onAdd={(assets) => {
                setProductAssets((current) => [
                  ...current,
                  ...assets.filter((asset) => !current.some((item) => item.id === asset.id)),
                ]);
                mutateInput(
                  "productAssetIds",
                  [...new Set([...input.productAssetIds, ...assets.map((asset) => asset.id)])].slice(0, 6),
                );
              }}
              onRemove={(id) =>
                mutateInput(
                  "productAssetIds",
                  input.productAssetIds.filter((item) => item !== id),
                )
              }
            />
            <Button
              className="w-full"
              variant="outline"
              size="sm"
              disabled={!input.productAssetIds.length || Boolean(busy)}
              onClick={() => action("analyze")}
            >
              {busy === "analyze" || active === "analyzing" ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
              AI 填充参数
            </Button>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>人像图片</Label>
              <span className="text-xs text-muted">可选</span>
            </div>
            {selectedPortrait ? (
              <div className="flex items-center gap-2 rounded-lg border border-line p-2 [&_img]:h-12 [&_img]:w-9 [&_img]:rounded-md [&_img]:object-cover">
                <img src={selectedPortrait.source_url} alt={selectedPortrait.name} />
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{selectedPortrait.name}</span>
                <Button variant="ghost" size="sm" onClick={() => mutateInput("portraitId", undefined)}>
                  移除
                </Button>
              </div>
            ) : (
              <Button
                className="w-full justify-between"
                variant="outline"
                size="sm"
                onClick={() => setPortraitPickerOpen(true)}
              >
                未添加人像 <span>添加</span>
              </Button>
            )}
          </section>

          <section className="space-y-2">
            <Label>广告场景</Label>
            <div className="flex flex-wrap gap-2">
              {scenes.map((scene) => (
                <Button
                  className={cn(
                    "h-8 rounded-full px-3 font-normal",
                    input.scene === scene && "border-primary bg-primary text-white hover:bg-primary/90",
                  )}
                  variant="outline"
                  size="sm"
                  key={scene}
                  onClick={() => mutateInput("scene", scene)}
                >
                  {scene}
                </Button>
              ))}
            </div>
          </section>

          <div className="space-y-2">
            <Label htmlFor="video-create-product-name">
              产品名称 <span className="text-error">*</span>
            </Label>
            <Input
              id="video-create-product-name"
              value={input.productName}
              maxLength={60}
              placeholder="输入产品名称"
              onChange={(event) => mutateInput("productName", event.target.value)}
            />
          </div>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>核心卖点</Label>
              <span className="text-xs text-muted">最多 8 条</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {sellingPoints.map((point, index) => (
                <span
                  className="inline-flex h-8 items-center gap-1 rounded-full bg-surface-strong px-3 text-xs text-ink"
                  key={point}
                >
                  {point}
                  <Button
                    className="size-5 rounded-full p-0"
                    variant="ghost"
                    size="icon"
                    aria-label="删除卖点"
                    onClick={() =>
                      mutateInput(
                        "sellingPoints",
                        sellingPoints.filter((_, item) => item !== index),
                      )
                    }
                  >
                    <X />
                  </Button>
                </span>
              ))}
              <Input
                className="min-w-40 flex-1"
                placeholder="输入卖点回车添加"
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  const value = event.currentTarget.value.trim();
                  if (!value || sellingPoints.length >= 8) return;
                  mutateInput("sellingPoints", [...sellingPoints, value]);
                  event.currentTarget.value = "";
                }}
              />
            </div>
          </section>

          <section className="space-y-2">
            <Label>视频时长</Label>
            <div className="grid grid-cols-4 gap-2">
              {durationOptions.map((seconds) => (
                <Button
                  className={cn(
                    input.durationSec === seconds && "border-primary bg-primary text-white hover:bg-primary/90",
                  )}
                  variant="outline"
                  size="sm"
                  key={seconds}
                  onClick={() => {
                    mutateInput("durationSec", seconds);
                    mutateInput("segmentCount", Math.max(input.segmentCount, Math.ceil(seconds / 15)));
                  }}
                >
                  {seconds < 60 ? `${seconds}s` : `${seconds / 60}min`}
                </Button>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <Label>分镜段数</Label>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => mutateInput("segmentCount", Math.max(1, input.segmentCount - 1))}
              >
                −
              </Button>
              <span className="w-8 text-center font-medium text-ink">{input.segmentCount}</span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => mutateInput("segmentCount", Math.min(12, input.segmentCount + 1))}
              >
                ＋
              </Button>
              <span className="text-xs text-muted">段，单段不超过 15 秒</span>
            </div>
          </section>

          <section className="space-y-2">
            <Label>配音语速</Label>
            <div className="grid grid-cols-3 gap-2">
              {(["slow", "medium", "fast"] as const).map((speed) => (
                <Button
                  className={cn(
                    "h-auto flex-col gap-0.5 py-2",
                    input.speechRate === speed && "border-primary bg-primary text-white hover:bg-primary/90",
                  )}
                  variant="outline"
                  key={speed}
                  onClick={() => mutateInput("speechRate", speed)}
                >
                  <span>{speed === "slow" ? "慢" : speed === "medium" ? "中" : "快"}</span>
                  <span className={cn("text-xs font-normal text-muted", input.speechRate === speed && "text-white/75")}>
                    {speed === "slow" ? "3字/s" : speed === "medium" ? "4字/s" : "5字/s"}
                  </span>
                </Button>
              ))}
            </div>
          </section>

          <ParameterPanel
            title="广告诉求"
            count={requirementCount}
            open={openPanels.requirements}
            onToggle={() => togglePanel("requirements")}
          >
            <ChoiceGroup
              label="营销目标"
              options={marketingGoals}
              selected={input.marketingGoals ?? []}
              onToggle={(option) => toggleOption("marketingGoals", option)}
            />
            <ChoiceGroup
              label="目标受众"
              options={targetAudiences}
              selected={input.targetAudiences ?? []}
              onToggle={(option) => toggleOption("targetAudiences", option)}
            />
            <div className="space-y-2">
              <Label htmlFor="video-create-pain-points">用户痛点</Label>
              <textarea
                id="video-create-pain-points"
                className="min-h-20 w-full resize-y rounded-md border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                value={input.audiencePainPoints}
                onChange={(event) => mutateInput("audiencePainPoints", event.target.value)}
                placeholder="例：夏天防晒产品总是厚重泛白"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="video-create-benefits">产品利益点</Label>
              <textarea
                id="video-create-benefits"
                className="min-h-20 w-full resize-y rounded-md border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                value={input.productBenefits}
                onChange={(event) => mutateInput("productBenefits", event.target.value)}
                placeholder="例：零感轻薄，一抹即化"
              />
            </div>
          </ParameterPanel>

          <ParameterPanel
            title="脚本风格"
            count={styleCount}
            open={openPanels.style}
            onToggle={() => togglePanel("style")}
          >
            <ChoiceGroup
              label="主播角色"
              options={presenterRoles}
              selected={input.presenterRoles ?? []}
              onToggle={(option) => toggleOption("presenterRoles", option)}
            />
            <ChoiceGroup
              label="主播性别"
              options={presenterGenders}
              selected={input.presenterGenders ?? []}
              onToggle={(option) => toggleOption("presenterGenders", option)}
            />
            <ChoiceGroup
              label="内容风格"
              options={contentStyles}
              selected={input.contentStyles ?? []}
              onToggle={(option) => toggleOption("contentStyles", option)}
            />
            <ChoiceGroup
              label="开场方式"
              options={openingStyles}
              selected={input.openingStyles ?? []}
              onToggle={(option) => toggleOption("openingStyles", option)}
            />
            <ChoiceGroup
              label="结尾引导"
              options={closingGuides}
              selected={input.closingGuides ?? []}
              onToggle={(option) => toggleOption("closingGuides", option)}
            />
          </ParameterPanel>

          <ParameterPanel
            title="高级设置"
            count={advancedCount}
            open={openPanels.advanced}
            onToggle={() => togglePanel("advanced")}
          >
            <ChoiceGroup
              label="脚本题材"
              options={scriptTopics}
              selected={input.scriptTopics ?? []}
              onToggle={(option) => toggleOption("scriptTopics", option)}
            />
            <ChoiceGroup
              label="素材话题"
              options={materialTopics}
              selected={input.materialTopics ?? []}
              onToggle={(option) => toggleOption("materialTopics", option)}
            />
            <ChoiceGroup
              label="营销手法"
              options={marketingMethods}
              selected={input.marketingMethods ?? []}
              onToggle={(option) => toggleOption("marketingMethods", option)}
            />
            <ChoiceGroup
              label="模板"
              options={templates}
              selected={input.templates ?? []}
              onToggle={(option) => toggleOption("templates", option)}
            />
            <div className="space-y-2">
              <Label htmlFor="video-create-sensitive-words">敏感词</Label>
              <Input
                id="video-create-sensitive-words"
                value={input.sensitiveWords}
                onChange={(event) => mutateInput("sensitiveWords", event.target.value)}
                placeholder="用空格分隔，如：最佳 极致"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="video-create-custom-requirements">自定义要求</Label>
              <textarea
                id="video-create-custom-requirements"
                className="min-h-20 w-full resize-y rounded-md border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                value={input.customRequirements}
                onChange={(event) => mutateInput("customRequirements", event.target.value)}
                placeholder="补充品牌语气、禁用表达或其他要求"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="video-create-model">视频模型</Label>
                <NativeSelect
                  id="video-create-model"
                  value={input.videoModel}
                  onChange={(event) => mutateInput("videoModel", event.target.value as VideoCreateInput["videoModel"])}
                >
                  <option value="doubao-seedance-2-0-fast-260128">Seedance 2.0 Fast</option>
                  <option value="doubao-seedance-2-0-mini-260615">Seedance 2.0 Mini</option>
                  <option value="doubao-seedance-2-0-260128">Seedance 2.0 Standard</option>
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="video-create-ratio">画面比例</Label>
                <NativeSelect
                  id="video-create-ratio"
                  value={input.ratio}
                  onChange={(event) => mutateInput("ratio", event.target.value as VideoCreateInput["ratio"])}
                >
                  <option>9:16</option>
                  <option>16:9</option>
                  <option>1:1</option>
                </NativeSelect>
              </div>
            </div>
            <div className="space-y-2" data-testid="video-create-voice-field">
              <Label>配音音色</Label>
              <AttachmentPicker
                accept="audio/*"
                onSelect={([asset]) => asset && mutateInput("voiceAssetId", asset.id)}
                trigger={(open) => (
                  <Button className="w-full justify-start" variant="outline" size="sm" onClick={open}>
                    {input.voiceAssetId ? "已选择我的音色" : "默认推荐音色（点击更换）"}
                  </Button>
                )}
              />
            </div>
          </ParameterPanel>
        </div>
        {!hasScript && (
          <footer className="shrink-0 border-t border-line bg-surface p-3">
            <Button
              className="h-10 w-full rounded-full"
              disabled={Boolean(busy) || polling || !input.productAssetIds.length}
              onClick={() => action("script")}
            >
              {busy === "script" || active === "script_generating" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <WandSparkles />
              )}
              生成脚本
            </Button>
          </footer>
        )}
      </aside>

      <main
        className="relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface max-[760px]:min-h-[calc(100vh-56px)] max-[760px]:border-t-8 max-[760px]:border-surface-muted"
        data-testid="video-create-output-panel"
      >
        <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-line px-3">
          <nav className="flex h-full items-center gap-1">
            <Button
              className={cn("h-8 rounded-full", tab === "script" && "bg-primary text-white hover:bg-primary/90")}
              variant="ghost"
              size="sm"
              onClick={() => setTab("script")}
            >
              脚本 <span className="rounded-full bg-current/10 px-1.5 text-xs">{project?.sections.length ?? 0}</span>
            </Button>
            <Button
              className={cn("h-8 rounded-full", tab === "storyboard" && "bg-primary text-white hover:bg-primary/90")}
              variant="ghost"
              size="sm"
              onClick={() => setTab("storyboard")}
            >
              分镜 <span className="rounded-full bg-current/10 px-1.5 text-xs">{project?.shots.length ?? 0}</span>
            </Button>
          </nav>
          <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
            <History /> 生成记录
          </Button>
        </header>
        {(notice || project?.project.error?.message) && (
          <Button
            className="absolute left-1/2 top-16 z-10 h-auto max-w-[calc(100%-24px)] -translate-x-1/2 whitespace-normal border-error/25 bg-surface px-3 py-2 text-left text-error shadow-sm"
            variant="outline"
            onClick={() => setNotice("")}
          >
            <AlertTriangle />
            <span className="flex-1">{notice || project?.project.error?.message}</span>
            <X />
          </Button>
        )}

        {!project?.sections.length && !["script_generating", "analyzing"].includes(active ?? "") && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted">
            <span className="grid size-12 place-items-center rounded-full bg-surface-muted">
              <Film className="size-5" />
            </span>
            <b className="font-medium text-body-strong">产出物将在这里呈现</b>
          </div>
        )}
        {["script_generating", "analyzing", "storyboard_generating", "composing"].includes(active ?? "") && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted">
            <span className="grid size-12 place-items-center rounded-full bg-surface-muted text-ink">
              <LoaderCircle className="animate-spin" />
            </span>
            <h2 className="text-base font-medium text-ink">{statusLabels[active ?? ""]}</h2>
            <p className="text-xs">任务在 Worker 中执行，关闭页面后也会继续。</p>
          </div>
        )}

        {tab === "script" && project?.sections.length ? (
          <section className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-canvas-soft px-3">
              <span className="text-xs text-muted">
                共 <b>{totalCharacters}</b> 字 · 约 <b>{totalDuration}s</b>
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      project.sections
                        .map((section) => drafts[section.id] ?? section.currentVersion?.text ?? "")
                        .join("\n"),
                    )
                  }
                >
                  <Copy />
                  复制脚本
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {project.sections.map((section) => {
                const version = section.currentVersion;
                const value = drafts[section.id] ?? version?.text ?? "";
                const dirty = value !== (version?.text ?? "");
                return (
                  <article className="overflow-hidden rounded-xl border border-line bg-surface" key={section.id}>
                    <header className="flex min-h-10 items-center justify-between border-b border-line bg-canvas-soft px-3 py-2">
                      <span className="rounded-full bg-surface-strong px-2.5 py-1 text-xs font-medium text-ink">
                        {section.label}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted">
                          {estimateDuration(value, input.speechRate)}s · {[...value].length}字
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!version || actionAvailability.scriptLocked || Boolean(busy) || polling}
                          onClick={() =>
                            execute(`regen-${section.id}`, async () => {
                              if (!version) return;
                              await regenerateVideoCreateScriptSection({
                                projectId: project.project.id,
                                sectionId: section.id,
                                expectedVersionId: version.id,
                              });
                              void queryClient.invalidateQueries({
                                queryKey: ["video-create-project", project.project.id],
                              });
                            })
                          }
                        >
                          <RefreshCw />
                          换一版
                        </Button>
                        <Pencil className="size-4 text-muted" />
                      </div>
                    </header>
                    <textarea
                      className="min-h-24 w-full resize-y bg-transparent p-3 text-sm leading-relaxed text-body outline-none disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted"
                      value={value}
                      disabled={actionAvailability.scriptLocked}
                      onChange={(event) => setDrafts((current) => ({ ...current, [section.id]: event.target.value }))}
                    />
                    {dirty && (
                      <footer className="flex justify-end border-t border-line px-3 py-2">
                        <Button
                          size="sm"
                          disabled={actionAvailability.scriptLocked || Boolean(busy) || polling}
                          onClick={() =>
                            execute(`save-${section.id}`, async () => {
                              if (!version) return;
                              const next = await saveVideoCreateScriptSection({
                                projectId: project.project.id,
                                sectionId: section.id,
                                expectedVersionId: version.id,
                                text: value,
                                durationSec: estimateDuration(value, input.speechRate),
                              });
                              setDrafts((current) => {
                                const copy = { ...current };
                                delete copy[section.id];
                                return copy;
                              });
                              invalidate(next);
                            })
                          }
                        >
                          <Check />
                          保存修改
                        </Button>
                      </footer>
                    )}
                  </article>
                );
              })}
            </div>
            <footer className="flex h-14 shrink-0 items-center justify-end border-t border-line bg-surface px-3">
              <Button
                className="rounded-full"
                disabled={actionAvailability.storyboardLocked || Boolean(busy) || polling}
                onClick={() => action("storyboard")}
              >
                {busy === "storyboard" || active === "storyboard_generating" ? (
                  <LoaderCircle className="animate-spin" />
                ) : actionAvailability.storyboardLocked ? (
                  <Check />
                ) : (
                  <WandSparkles />
                )}
                {actionAvailability.storyboardLabel}
              </Button>
            </footer>
          </section>
        ) : null}

        {tab === "storyboard" && project?.shots.length ? (
          <section className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-canvas-soft px-3">
              <div className="flex items-center gap-2">
                <b className="font-medium text-ink">分镜编辑</b>
                <span className="rounded-full bg-surface-strong px-2 py-0.5 text-xs text-muted">
                  {project.shots.length} 个段落
                </span>
              </div>
              <div className="flex rounded-full border border-line bg-surface p-0.5">
                <Button
                  className={cn(
                    "h-7 rounded-full border-0 px-3",
                    input.priority === "speech" && "bg-primary text-white",
                  )}
                  variant="ghost"
                  size="sm"
                  onClick={() => mutateInput("priority", "speech")}
                >
                  口播优先
                </Button>
                <Button
                  className={cn(
                    "h-7 rounded-full border-0 px-3",
                    input.priority === "visual" && "bg-primary text-white",
                  )}
                  variant="ghost"
                  size="sm"
                  onClick={() => mutateInput("priority", "visual")}
                >
                  画面优先
                </Button>
              </div>
            </div>
            {project.project.finalArtifactId && (
              <div className="m-3 grid grid-cols-[112px_1fr] gap-4 rounded-xl border border-line bg-canvas-soft p-3 [&_img]:h-36 [&_img]:w-28 [&_img]:rounded-lg [&_img]:object-cover [&_video]:h-36 [&_video]:w-28 [&_video]:rounded-lg [&_video]:object-cover">
                <AuthenticatedMedia
                  url={`/api/artifacts/${project.project.finalArtifactId}`}
                  mimeType="video/mp4"
                  alt="最终成片"
                />
                <div className="flex min-w-0 flex-col items-start justify-center gap-2">
                  <h2 className="text-base font-medium text-ink">完整成片已生成</h2>
                  <Button
                    size="sm"
                    onClick={() =>
                      void downloadAuthenticated(
                        `/api/artifacts/${project.project.finalArtifactId}`,
                        `${project.project.title}.mp4`,
                      )
                    }
                  >
                    <Download /> 下载成片
                  </Button>
                </div>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto pb-16">
              <div className="grid h-10 min-w-[1120px] grid-cols-[40px_minmax(240px,1fr)_minmax(240px,1fr)_minmax(280px,1fr)_minmax(280px,1fr)] items-center border-b border-line bg-canvas-soft text-xs font-medium text-muted">
                <span>#</span>
                <span>分镜段落</span>
                <span className="flex items-center justify-between gap-2 pr-3">
                  素材
                  <Button
                    className="h-7 px-2"
                    variant="outline"
                    size="sm"
                    disabled={!batchEligibleShots.length || Boolean(busy)}
                    onClick={() => {
                      setBatchSettings({
                        videoModel: input.videoModel ?? "doubao-seedance-2-0-fast-260128",
                        ratio: input.ratio ?? "9:16",
                        resolution: "720p",
                      });
                      setBatchDialogOpen(true);
                    }}
                  >
                    <WandSparkles /> 批量生成
                  </Button>
                </span>
                <span className="flex items-center justify-between px-3">
                  <span className="flex items-center gap-1.5">
                    <Mic className="size-4" />
                    配音
                  </span>
                  <Switch
                    checked={project.shots.every((item) => item.audioEnabled)}
                    aria-label="全部分镜配音"
                    disabled={Boolean(busy)}
                    onCheckedChange={(checked) =>
                      void execute("audio-all", async () => {
                        const next = await updateAllVideoCreateShotOptions(project.project.id, {
                          audioEnabled: checked,
                        });
                        invalidate(next);
                      })
                    }
                  />
                </span>
                <span className="flex items-center justify-between px-3">
                  <span className="flex items-center gap-1.5">
                    <Captions className="size-4" />
                    字幕
                  </span>
                  <Switch
                    checked={project.shots.every((item) => item.subtitleEnabled)}
                    aria-label="全部分镜字幕"
                    disabled={Boolean(busy)}
                    onCheckedChange={(checked) =>
                      void execute("subtitle-all", async () => {
                        const next = await updateAllVideoCreateShotOptions(project.project.id, {
                          subtitleEnabled: checked,
                        });
                        invalidate(next);
                      })
                    }
                  />
                </span>
              </div>
              {project.shots.map((shot) => {
                const section = project.sections.find((item) => item.id === shot.scriptSectionId);
                const generating = shot.status === "queued" || shot.status === "generating";
                return (
                  <article
                    className="grid min-h-64 min-w-[1120px] grid-cols-[40px_minmax(240px,1fr)_minmax(240px,1fr)_minmax(280px,1fr)_minmax(280px,1fr)] border-b border-line"
                    key={shot.id}
                  >
                    <span className="border-r border-line p-3 text-xs text-muted">
                      {String(shot.ordinal).padStart(2, "0")}
                    </span>
                    <div className="space-y-2 border-r border-line p-3">
                      <span className="inline-flex rounded-full bg-surface-strong px-2 py-1 text-xs text-muted">
                        {shot.durationSec}s
                      </span>
                      <p className="leading-relaxed text-body">{section?.currentVersion?.text}</p>
                      <small className="text-xs text-muted">0–{shot.durationSec}s · 1 镜</small>
                    </div>
                    <div className="border-r border-line p-3">
                      {shot.videoAssetId ? (
                        <div className="h-36 w-24 overflow-hidden rounded-lg bg-surface-muted [&_img]:h-full [&_img]:w-full [&_img]:object-cover [&_video]:h-full [&_video]:w-full [&_video]:object-cover">
                          <AuthenticatedMedia
                            url={
                              shot.status === "replaced"
                                ? `/api/assets/${shot.videoAssetId}/content`
                                : `/api/artifacts/${shot.videoAssetId}`
                            }
                            mimeType="video/mp4"
                            alt={`分镜 ${shot.ordinal}`}
                          />
                        </div>
                      ) : (
                        <div
                          className={cn(
                            "flex h-36 w-24 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-surface-muted text-xs text-muted",
                            shot.status === "failed" && "border-error/40 bg-error/5 text-error",
                          )}
                        >
                          {generating ? (
                            <LoaderCircle className="animate-spin" />
                          ) : shot.status === "failed" ? (
                            <>
                              <AlertTriangle />
                              <span>失败</span>
                            </>
                          ) : (
                            <>
                              <Video />
                              <span>待生成</span>
                            </>
                          )}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={generating || Boolean(busy)}
                          onClick={() =>
                            execute(`shot-${shot.id}`, async () => {
                              await generateVideoCreateShotVideo(project.project.id, shot.id);
                              void queryClient.invalidateQueries({
                                queryKey: ["video-create-project", project.project.id],
                              });
                            })
                          }
                        >
                          {generating ? <LoaderCircle className="animate-spin" /> : <Video />}
                          {shot.status === "failed" ? "重新生成" : shot.videoAssetId ? "再生成" : "AI生成视频"}
                        </Button>
                        <AttachmentPicker
                          accept="video/*"
                          initialSource="library"
                          onSelect={([asset]) =>
                            asset &&
                            void execute(`replace-${shot.id}`, async () => {
                              const next = await replaceVideoCreateShotVideo(project.project.id, shot.id, asset.id);
                              invalidate(next);
                            })
                          }
                          trigger={(open) => (
                            <Button variant="outline" size="sm" onClick={open}>
                              <FolderOpen /> 素材库
                            </Button>
                          )}
                        />
                        <AttachmentPicker
                          accept="video/*"
                          initialSource="upload"
                          onSelect={([asset]) =>
                            asset &&
                            void execute(`upload-replace-${shot.id}`, async () => {
                              const next = await replaceVideoCreateShotVideo(project.project.id, shot.id, asset.id);
                              invalidate(next);
                            })
                          }
                          trigger={(open) => (
                            <Button variant="outline" size="sm" onClick={open}>
                              <Upload /> 本地上传
                            </Button>
                          )}
                        />
                      </div>
                      {shot.error && <small className="mt-2 block text-xs text-error">{shot.error.message}</small>}
                    </div>
                    <div className={cn("border-r border-line p-3", !shot.audioEnabled && "opacity-50")}>
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <p className="leading-relaxed text-body">{section?.currentVersion?.text}</p>
                        <Switch
                          checked={shot.audioEnabled}
                          aria-label={`分镜 ${shot.ordinal} 配音`}
                          disabled={Boolean(busy)}
                          onCheckedChange={(checked) =>
                            void execute(`audio-${shot.id}`, async () => {
                              const next = await updateVideoCreateShotOptions(project.project.id, shot.id, {
                                audioEnabled: checked,
                                subtitleEnabled: shot.subtitleEnabled,
                              });
                              invalidate(next);
                            })
                          }
                        />
                      </div>
                      {shot.audioArtifactId ? (
                        <div className="w-full [&_audio]:h-9 [&_audio]:w-full">
                          <AuthenticatedMedia
                            url={`/api/artifacts/${shot.audioArtifactId}`}
                            mimeType="audio/wav"
                            alt={`分镜 ${shot.ordinal} 配音`}
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-muted">生成分镜视频后可试听配音</span>
                      )}
                    </div>
                    <div className={cn("p-3", !shot.subtitleEnabled && "opacity-50")}>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <span className="text-xs text-muted">{shot.subtitleCues.length} 条字幕</span>
                        <Switch
                          checked={shot.subtitleEnabled}
                          aria-label={`分镜 ${shot.ordinal} 字幕`}
                          disabled={Boolean(busy)}
                          onCheckedChange={(checked) =>
                            void execute(`subtitle-${shot.id}`, async () => {
                              const next = await updateVideoCreateShotOptions(project.project.id, shot.id, {
                                audioEnabled: shot.audioEnabled,
                                subtitleEnabled: checked,
                              });
                              invalidate(next);
                            })
                          }
                        />
                      </div>
                      {shot.subtitleCues.length ? (
                        <div className="space-y-2">
                          {shot.subtitleCues.map((cue) => (
                            <div key={`${cue.startSec}-${cue.endSec}-${cue.text}`}>
                              <div className="text-xs text-muted">
                                {cue.startSec.toFixed(1)}s ～ {cue.endSec.toFixed(1)}s
                              </div>
                              <p className="mt-0.5 leading-relaxed text-body">{cue.text}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted">生成配音后自动生成字幕时间轴</span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            <footer className="absolute inset-x-0 bottom-0 flex h-14 items-center justify-end gap-3 border-t border-line bg-surface px-3">
              <span className="text-xs text-muted">
                {project.canCompose
                  ? "全部分镜已就绪"
                  : `还有 ${
                      project.shots.filter(
                        (shot) =>
                          !["succeeded", "replaced"].includes(shot.status) ||
                          (shot.audioEnabled && !shot.audioArtifactId) ||
                          (shot.subtitleEnabled && !shot.subtitleCues.length),
                      ).length
                    } 个分镜未就绪`}
              </span>
              <Button
                className="rounded-full"
                disabled={!project.canCompose || Boolean(busy)}
                onClick={() => action("compose")}
              >
                <Film />
                合并视频
              </Button>
            </footer>
          </section>
        ) : null}
      </main>
      <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
        <DialogContent className="max-h-[calc(100vh-32px)] overflow-y-auto p-0">
          <DialogHeader className="border-b border-line px-5 py-4">
            <DialogTitle>AI 视频生成设置</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-5">
            <div className="overflow-hidden rounded-xl border border-line">
              {videoModelOptions.map((model) => {
                const selected = batchSettings.videoModel === model.id;
                return (
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between gap-3 border-b border-line px-4 py-3 text-left last:border-b-0",
                      selected ? "bg-surface-strong text-ink" : "bg-surface hover:bg-canvas-soft",
                    )}
                    key={model.id}
                    onClick={() => setBatchSettings((current) => ({ ...current, videoModel: model.id }))}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 font-medium">
                        {model.name}
                        <span className="rounded-full bg-surface-strong px-2 py-0.5 text-xs text-muted">
                          {model.tag}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs text-muted">{model.description}</span>
                    </span>
                    {selected && <Check className="size-5 shrink-0" />}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-line bg-canvas-soft px-4 py-3">
              <span className="grid size-6 place-items-center rounded-md bg-primary text-white">
                <Check className="size-4" />
              </span>
              <span>
                <b className="font-medium text-ink">不生成声音</b>
                <span className="ml-2 text-xs text-muted">后续使用分镜独立配音</span>
              </span>
            </div>
            <div className="space-y-4 rounded-xl border border-line bg-canvas-soft p-4">
              <div className="space-y-2">
                <Label>画面比例</Label>
                <div className="flex flex-wrap gap-2">
                  {(["9:16", "16:9", "1:1"] as const).map((ratio) => (
                    <Button
                      className={cn(batchSettings.ratio === ratio && "bg-primary text-white")}
                      variant="outline"
                      size="sm"
                      key={ratio}
                      onClick={() => setBatchSettings((current) => ({ ...current, ratio }))}
                    >
                      {ratio}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>清晰度</Label>
                <div className="flex gap-2">
                  {(["480p", "720p"] as const).map((resolution) => (
                    <Button
                      className={cn(batchSettings.resolution === resolution && "bg-primary text-white")}
                      variant="outline"
                      size="sm"
                      key={resolution}
                      onClick={() => setBatchSettings((current) => ({ ...current, resolution }))}
                    >
                      {resolution.toUpperCase()}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>时长（秒）</Label>
                <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs text-muted">
                  时长自动取每个分镜的实际时长，4～15 秒内取整
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="border-t border-line px-5 py-4">
            <Button variant="outline" onClick={() => setBatchDialogOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!project || !batchEligibleShots.length || Boolean(busy)}
              onClick={() =>
                project &&
                void execute("batch-shots", async () => {
                  const result = await batchGenerateVideoCreateShotVideos(project.project.id, {
                    ...batchSettings,
                    generateAudio: false,
                  });
                  const submitted = new Set(result.submittedShotIds);
                  setProject((current) =>
                    current
                      ? {
                          ...current,
                          shots: current.shots.map((shot) =>
                            submitted.has(shot.id) ? { ...shot, status: "queued" as const, error: undefined } : shot,
                          ),
                        }
                      : current,
                  );
                  setBatchDialogOpen(false);
                  void queryClient.invalidateQueries({ queryKey: ["video-create-project", project.project.id] });
                })
              }
            >
              {busy === "batch-shots" ? <LoaderCircle className="animate-spin" /> : <WandSparkles />}
              确认生成（{batchEligibleShots.length} 个）
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PortraitPickerDialog
        open={portraitPickerOpen}
        portraits={portraits}
        loading={portraitsLoading}
        selectedId={input.portraitId}
        onClose={() => setPortraitPickerOpen(false)}
        onSelect={(portrait) => {
          mutateInput("portraitId", portrait.index);
          setPortraitPickerOpen(false);
        }}
      />
      <HistoryDrawer
        open={historyOpen}
        projects={history}
        onClose={() => setHistoryOpen(false)}
        onSelect={(selected) => {
          setProject(selected);
          setInput(selected.project.input);
          setHistoryOpen(false);
          setTab(selected.shots.length ? "storyboard" : "script");
        }}
      />
    </div>
  );
}
