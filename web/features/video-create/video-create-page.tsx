// biome-ignore-all lint/a11y/useButtonType: This workbench does not use native form submission.
// biome-ignore-all lint/a11y/noStaticElementInteractions: Modal backdrops dismiss their dialogs.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  Download,
  Film,
  History,
  LoaderCircle,
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
  createVideoCreate,
  downloadAuthenticated,
  fetchVideoCreateProject,
  fetchVideoCreateProjects,
  generateVideoCreateShotVideo,
  regenerateVideoCreateScriptSection,
  replaceVideoCreateShotVideo,
  runVideoCreateProjectAction,
  saveVideoCreateScriptSection,
  updateVideoCreate,
  updateVideoCreateShotOptions,
} from "@/api/api-client";
import type { VideoCreateInput, VideoCreateProject } from "@/api/generated/types.gen";
import { AttachmentPicker, type AttachmentSelection } from "@/components/domain/attachment-picker";
import { AuthenticatedMedia } from "@/components/domain/authenticated-media";
import "./video-create-page.css";

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
  segmentCount: 1,
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
    <div className="vc-choice-group">
      <strong>{label}</strong>
      <div className="vc-choice-list">
        {options.map((option) => (
          <button
            className={selected.includes(option) ? "active" : ""}
            aria-pressed={selected.includes(option)}
            key={option}
            onClick={() => onToggle(option)}
          >
            {selected.includes(option) && <Check />}
            {option}
          </button>
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
    <section className={`vc-parameter-panel ${open ? "open" : ""}`}>
      <button className="vc-collapse" aria-expanded={open} onClick={onToggle}>
        <span>
          <b>{title}</b>
          {count > 0 && <i>{count}</i>}
          <small>{count ? "已选" : "可选"}</small>
        </span>
        <ChevronDown className={open ? "open" : ""} />
      </button>
      {open && <div className="vc-parameter-content">{children}</div>}
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
    <div className="vc-image-grid">
      {visible.map((asset) => (
        <div className="vc-image-card" key={asset.id}>
          <AuthenticatedMedia url={`/api/assets/${asset.id}/content`} mimeType={asset.mimeType} alt={asset.name} />
          <button aria-label="移除商品图片" onClick={() => onRemove(asset.id)}>
            <X />
          </button>
          <span>待解析</span>
        </div>
      ))}
      {ids.length < 6 && (
        <AttachmentPicker
          accept="image/*"
          multiple
          onSelect={onAdd}
          trigger={(open) => (
            <button className="vc-add-image" onClick={open}>
              <Plus />
              添加
            </button>
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
    <div className="vc-history-layer" role="presentation" onMouseDown={onClose}>
      <aside className="vc-history" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="vc-history-head">
          <div>
            <span>PROJECT HISTORY</span>
            <h2>生成记录</h2>
          </div>
          <button aria-label="关闭生成记录" onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="vc-history-list">
          {projects.map((item) => (
            <button key={item.project.id} onClick={() => onSelect(item)}>
              <span className={`vc-history-status ${item.project.status}`}>{statusLabels[item.project.status]}</span>
              <b>{item.project.title}</b>
              <small>{item.project.input.productName || "尚未填写产品名称"}</small>
              <time>{new Date(item.project.updatedAt).toLocaleString()}</time>
            </button>
          ))}
          {!projects.length && <p>暂无生成记录</p>}
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
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const active = project?.project.status;
  const hasRunningShot = project?.shots.some((shot) => shot.status === "queued" || shot.status === "generating");
  const projectId = project?.project.id;
  const sellingPoints = input.sellingPoints ?? [];
  const polling =
    Boolean(active && ["analyzing", "script_generating", "storyboard_generating", "composing"].includes(active)) ||
    hasRunningShot;
  const { data: history = [] } = useQuery({
    queryKey: ["video-create-projects"],
    queryFn: fetchVideoCreateProjects,
    refetchInterval: polling ? 3_000 : false,
  });
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
    <div className="video-create-page">
      <aside className="vc-config-panel">
        <header className="vc-config-head">
          <div>
            <span>NEW PROJECT</span>
            <h1>新建项目</h1>
          </div>
          <button onClick={reset}>
            <Plus /> 新建
          </button>
        </header>
        <div className="vc-config-scroll">
          <section className="vc-field">
            <div className="vc-field-label">
              产品图片 <small>（AI 智能分析）</small>
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
            <button
              className="vc-ai-fill"
              disabled={!input.productAssetIds.length || Boolean(busy)}
              onClick={() => action("analyze")}
            >
              {busy === "analyze" || active === "analyzing" ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
              AI 填充参数（推荐先点我）
            </button>
          </section>

          <section className="vc-field">
            <div className="vc-field-label">
              人像图片 <small>（可选）</small>
            </div>
            {input.portraitAssetId ? (
              <div className="vc-selected-asset">
                <AuthenticatedMedia
                  url={`/api/assets/${input.portraitAssetId}/content`}
                  mimeType="image/png"
                  alt="已选人像"
                />
                <button onClick={() => mutateInput("portraitAssetId", undefined)}>移除</button>
              </div>
            ) : (
              <AttachmentPicker
                accept="image/*"
                onSelect={([asset]) => asset && mutateInput("portraitAssetId", asset.id)}
                trigger={(open) => (
                  <button className="vc-inline-add" onClick={open}>
                    未添加人像 <span>+ 添加</span>
                  </button>
                )}
              />
            )}
          </section>

          <section className="vc-field">
            <div className="vc-field-label">广告场景</div>
            <div className="vc-chip-grid">
              {scenes.map((scene) => (
                <button
                  className={input.scene === scene ? "active" : ""}
                  key={scene}
                  onClick={() => mutateInput("scene", scene)}
                >
                  {scene}
                </button>
              ))}
            </div>
          </section>

          <label className="vc-field">
            <span>
              产品名称 <em>*</em>
            </span>
            <input
              value={input.productName}
              maxLength={60}
              placeholder="输入产品名称"
              onChange={(event) => mutateInput("productName", event.target.value)}
            />
          </label>

          <section className="vc-field">
            <div className="vc-field-label">
              核心卖点 <small>（最多 8 条）</small>
            </div>
            <div className="vc-selling-points">
              {sellingPoints.map((point, index) => (
                <span key={point}>
                  {point}
                  <button
                    aria-label="删除卖点"
                    onClick={() =>
                      mutateInput(
                        "sellingPoints",
                        sellingPoints.filter((_, item) => item !== index),
                      )
                    }
                  >
                    <X />
                  </button>
                </span>
              ))}
              <input
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

          <section className="vc-field">
            <div className="vc-field-label">视频时长</div>
            <div className="vc-duration-grid">
              {durationOptions.map((seconds) => (
                <button
                  className={input.durationSec === seconds ? "active" : ""}
                  key={seconds}
                  onClick={() => {
                    mutateInput("durationSec", seconds);
                    mutateInput("segmentCount", Math.max(input.segmentCount, Math.ceil(seconds / 15)));
                  }}
                >
                  {seconds < 60 ? `${seconds}s` : `${seconds / 60}min`}
                </button>
              ))}
            </div>
          </section>

          <section className="vc-field vc-inline-controls">
            <div className="vc-field-label">分镜段数</div>
            <div>
              <button onClick={() => mutateInput("segmentCount", Math.max(1, input.segmentCount - 1))}>−</button>
              <b>{input.segmentCount}</b>
              <button onClick={() => mutateInput("segmentCount", Math.min(12, input.segmentCount + 1))}>＋</button>
              <small>段（单段 ≤15s）</small>
            </div>
          </section>

          <section className="vc-field">
            <div className="vc-field-label">配音语速</div>
            <div className="vc-speed-grid">
              {(["slow", "medium", "fast"] as const).map((speed) => (
                <button
                  className={input.speechRate === speed ? "active" : ""}
                  key={speed}
                  onClick={() => mutateInput("speechRate", speed)}
                >
                  <b>{speed === "slow" ? "慢" : speed === "medium" ? "中" : "快"}</b>
                  <small>{speed === "slow" ? "3字/s" : speed === "medium" ? "4字/s" : "5字/s"}</small>
                </button>
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
            <label className="vc-text-option">
              <strong>用户痛点</strong>
              <textarea
                value={input.audiencePainPoints}
                onChange={(event) => mutateInput("audiencePainPoints", event.target.value)}
                placeholder="例：夏天防晒产品总是厚重泛白"
              />
            </label>
            <label className="vc-text-option">
              <strong>产品利益点</strong>
              <textarea
                value={input.productBenefits}
                onChange={(event) => mutateInput("productBenefits", event.target.value)}
                placeholder="例：零感轻薄，一抹即化"
              />
            </label>
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
            <label className="vc-text-option">
              <strong>敏感词</strong>
              <input
                value={input.sensitiveWords}
                onChange={(event) => mutateInput("sensitiveWords", event.target.value)}
                placeholder="用空格分隔，如：最佳 极致"
              />
            </label>
            <label className="vc-text-option">
              <strong>自定义要求</strong>
              <textarea
                value={input.customRequirements}
                onChange={(event) => mutateInput("customRequirements", event.target.value)}
                placeholder="补充品牌语气、禁用表达或其他要求"
              />
            </label>
            <div className="vc-advanced-grid">
              <label>
                视频模型
                <select
                  value={input.videoModel}
                  onChange={(event) => mutateInput("videoModel", event.target.value as VideoCreateInput["videoModel"])}
                >
                  <option value="doubao-seedance-2-0-fast-260128">Seedance 2.0 Fast</option>
                  <option value="doubao-seedance-2-0-mini-260615">Seedance 2.0 Mini</option>
                  <option value="doubao-seedance-2-0-260128">Seedance 2.0 Standard</option>
                </select>
              </label>
              <label>
                画面比例
                <select
                  value={input.ratio}
                  onChange={(event) => mutateInput("ratio", event.target.value as VideoCreateInput["ratio"])}
                >
                  <option>9:16</option>
                  <option>16:9</option>
                  <option>1:1</option>
                </select>
              </label>
            </div>
            <div className="vc-advanced-field">
              <strong>配音音色</strong>
              <AttachmentPicker
                accept="audio/*"
                onSelect={([asset]) => asset && mutateInput("voiceAssetId", asset.id)}
                trigger={(open) => (
                  <button className="vc-select-asset" onClick={open}>
                    {input.voiceAssetId ? "已选择我的音色" : "默认推荐音色（点击更换）"}
                  </button>
                )}
              />
            </div>
          </ParameterPanel>
        </div>
        <footer className="vc-primary-footer">
          <button
            disabled={Boolean(busy) || !input.productAssetIds.length}
            onClick={() => action(project?.sections.length ? "storyboard" : "script")}
          >
            {busy || ["script_generating", "storyboard_generating"].includes(active ?? "") ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <WandSparkles />
            )}
            {project?.sections.length ? "生成分镜" : "生成脚本"}
          </button>
        </footer>
      </aside>

      <main className="vc-output-panel">
        <header className="vc-output-head">
          <nav>
            <button className={tab === "script" ? "active" : ""} onClick={() => setTab("script")}>
              脚本 <i>{project?.sections.length ?? 0}</i>
            </button>
            <button className={tab === "storyboard" ? "active" : ""} onClick={() => setTab("storyboard")}>
              分镜 <i>{project?.shots.length ?? 0}</i>
            </button>
          </nav>
          <button className="vc-history-button" onClick={() => setHistoryOpen(true)}>
            <History /> 生成记录
          </button>
        </header>
        {(notice || project?.project.error?.message) && (
          <button className="vc-notice" onClick={() => setNotice("")}>
            <AlertTriangle />
            {notice || project?.project.error?.message}
            <X />
          </button>
        )}

        {!project?.sections.length && !["script_generating", "analyzing"].includes(active ?? "") && (
          <div className="vc-empty">
            <Film />
            <b>产出物将在这里呈现</b>
            <p>
              先在左侧添加商品图片并填写参数
              <br />
              生成脚本后可逐段审核，再继续制作分镜。
            </p>
          </div>
        )}
        {["script_generating", "analyzing", "storyboard_generating", "composing"].includes(active ?? "") && (
          <div className="vc-generating">
            <span>
              <LoaderCircle className="animate-spin" />
            </span>
            <h2>{statusLabels[active ?? ""]}</h2>
            <p>任务在 Worker 中执行，关闭页面后也会继续。</p>
          </div>
        )}

        {tab === "script" && project?.sections.length ? (
          <section className="vc-script-output">
            <div className="vc-script-toolbar">
              <span>
                共 <b>{totalCharacters}</b> 字 · 约 <b>{totalDuration}s</b>
              </span>
              <div>
                <button
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
                </button>
                <button onClick={() => action("script")}>
                  <RefreshCw />
                  重新生成
                </button>
              </div>
            </div>
            <div className="vc-script-list">
              {project.sections.map((section, index) => {
                const version = section.currentVersion;
                const value = drafts[section.id] ?? version?.text ?? "";
                const dirty = value !== (version?.text ?? "");
                return (
                  <article className={`tone-${index % 3}`} key={section.id}>
                    <header>
                      <span>{section.label}</span>
                      <div>
                        <i>
                          {estimateDuration(value, input.speechRate)}s · {[...value].length}字
                        </i>
                        <button
                          disabled={!version || Boolean(busy)}
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
                        </button>
                        <Pencil />
                      </div>
                    </header>
                    <textarea
                      value={value}
                      onChange={(event) => setDrafts((current) => ({ ...current, [section.id]: event.target.value }))}
                    />
                    {dirty && (
                      <footer>
                        <button
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
                        </button>
                      </footer>
                    )}
                  </article>
                );
              })}
            </div>
            <footer className="vc-next-footer">
              <button onClick={() => action("storyboard")}>
                <WandSparkles />
                下一步 · 生成分镜
              </button>
            </footer>
          </section>
        ) : null}

        {tab === "storyboard" && project?.shots.length ? (
          <section className="vc-storyboard-output">
            <div className="vc-storyboard-toolbar">
              <div>
                <b>分镜编辑</b>
                <span>{project.shots.length} 个段落</span>
              </div>
              <div className="vc-priority">
                <button
                  className={input.priority === "speech" ? "active" : ""}
                  onClick={() => mutateInput("priority", "speech")}
                >
                  口播优先
                </button>
                <button
                  className={input.priority === "visual" ? "active" : ""}
                  onClick={() => mutateInput("priority", "visual")}
                >
                  画面优先
                </button>
              </div>
            </div>
            {project.project.finalArtifactId && (
              <div className="vc-final-result">
                <AuthenticatedMedia
                  url={`/api/artifacts/${project.project.finalArtifactId}`}
                  mimeType="video/mp4"
                  alt="最终成片"
                />
                <div>
                  <span>FINAL VIDEO</span>
                  <h2>完整成片已生成</h2>
                  <p>脚本、分镜视频与设置均已保存在生成记录中。</p>
                  <button
                    onClick={() =>
                      void downloadAuthenticated(
                        `/api/artifacts/${project.project.finalArtifactId}`,
                        `${project.project.title}.mp4`,
                      )
                    }
                  >
                    <Download /> 下载成片
                  </button>
                </div>
              </div>
            )}
            <div className="vc-shot-table">
              <div className="vc-shot-head">
                <span>#</span>
                <span>分镜段落</span>
                <span>素材</span>
                <span>配音</span>
                <span>字幕</span>
              </div>
              {project.shots.map((shot) => {
                const section = project.sections.find((item) => item.id === shot.scriptSectionId);
                const generating = shot.status === "queued" || shot.status === "generating";
                return (
                  <article key={shot.id}>
                    <span>{String(shot.ordinal).padStart(2, "0")}</span>
                    <div className="vc-shot-copy">
                      <i>
                        段落
                        <br />
                        {shot.durationSec}s
                      </i>
                      <p>{section?.currentVersion?.text}</p>
                      <small>0–{shot.durationSec}s · 1 镜</small>
                    </div>
                    <div className="vc-shot-media">
                      {shot.videoAssetId ? (
                        <AuthenticatedMedia
                          url={
                            shot.status === "replaced"
                              ? `/api/assets/${shot.videoAssetId}/content`
                              : `/api/artifacts/${shot.videoAssetId}`
                          }
                          mimeType="video/mp4"
                          alt={`分镜 ${shot.ordinal}`}
                        />
                      ) : (
                        <div className={`vc-shot-placeholder ${shot.status}`}>
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
                      <div>
                        <button
                          disabled={generating || Boolean(busy)}
                          className="primary"
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
                        </button>
                        <AttachmentPicker
                          accept="video/*"
                          onSelect={([asset]) =>
                            asset &&
                            void execute(`replace-${shot.id}`, async () => {
                              const next = await replaceVideoCreateShotVideo(project.project.id, shot.id, asset.id);
                              invalidate(next);
                            })
                          }
                          trigger={(open) => (
                            <button aria-label="上传替代视频" onClick={open}>
                              <Upload />
                            </button>
                          )}
                        />
                      </div>
                      {shot.error && <small className="vc-shot-error">{shot.error.message}</small>}
                    </div>
                    <span>
                      <button
                        className={`vc-shot-toggle ${shot.audioEnabled ? "active" : ""}`}
                        onClick={() =>
                          execute(`audio-${shot.id}`, async () => {
                            const next = await updateVideoCreateShotOptions(project.project.id, shot.id, {
                              audioEnabled: !shot.audioEnabled,
                              subtitleEnabled: shot.subtitleEnabled,
                            });
                            invalidate(next);
                          })
                        }
                      >
                        <i /> {shot.audioEnabled ? "已开启" : "已关闭"}
                      </button>
                    </span>
                    <span>
                      <button
                        className={`vc-shot-toggle ${shot.subtitleEnabled ? "active" : ""}`}
                        onClick={() =>
                          execute(`subtitle-${shot.id}`, async () => {
                            const next = await updateVideoCreateShotOptions(project.project.id, shot.id, {
                              audioEnabled: shot.audioEnabled,
                              subtitleEnabled: !shot.subtitleEnabled,
                            });
                            invalidate(next);
                          })
                        }
                      >
                        <i /> {shot.subtitleEnabled ? "已开启" : "已关闭"}
                      </button>
                    </span>
                  </article>
                );
              })}
            </div>
            <footer className="vc-compose-footer">
              <span>
                {project.canCompose
                  ? "全部分镜已就绪"
                  : `还有 ${project.shots.filter((shot) => !["succeeded", "replaced"].includes(shot.status)).length} 个分镜未就绪`}
              </span>
              <button disabled={!project.canCompose || Boolean(busy)} onClick={() => action("compose")}>
                <Film />
                合并视频
              </button>
            </footer>
          </section>
        ) : null}
      </main>
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
