import { useQuery } from "@tanstack/react-query";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Image,
  Images,
  Library,
  LoaderCircle,
  Maximize2,
  RefreshCw,
  Sparkles,
  UserRound,
  Video,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { downloadAuthenticated, fetchCreationCapabilities, fetchJobs, submitJob } from "@/api/api-client";
import type { Job, SeedanceModelId } from "@/api/generated/types.gen";
import { AttachmentPicker } from "@/components/domain/attachment-picker";
import { randomUuid } from "@/lib/random-id";
import "./ai-creation-composer.css";

export interface CreationModelCapability {
  id: string;
  kind: "image" | "video";
  displayName: string;
  description: string;
  badges: string[];
  enabled: boolean;
  disabledReason?: string;
  executionMode: "real" | "mock";
  isDefault: boolean;
  supportedRatios: string[];
  supportedResolutions: string[];
  supportedDurations: number[];
  maxOutputs: number;
  supportsSeed: boolean;
  referenceModes: string[];
  acceptedReferenceKinds: string[];
  pricing: { baseCredits: number; perOutputCredits: number };
  dimensions?: Record<string, Record<string, { width: number; height: number }>>;
}

type AssetRef = {
  id: string;
  name: string;
  mimeType: string;
  label: string;
  source: "upload" | "library" | "portrait";
  size?: number;
};
type OpenPanel = "type" | "model" | "size" | "count" | "referenceMode" | "reference" | null;
type Draft = {
  prompt: string;
  modelId: string;
  ratio: string;
  resolution: string;
  count: number;
  seed: string;
  references: AssetRef[];
  referenceMode: string;
  duration: number;
  manualConfirm: boolean;
};

const imageRatios = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"];
const videoRatios = ["adaptive", "1:1", "16:9", "4:3", "3:4", "9:16", "21:9"];
const videoResolutions = ["480p", "720p", "1080p"];
const referenceModes = [
  { id: "omni", label: "全能参考", badge: "New" },
  { id: "first_frame", label: "首帧模式" },
  { id: "first_last_frame", label: "首尾帧模式" },
];

function Trigger({
  children,
  active,
  onClick,
  invalid = false,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  invalid?: boolean;
}) {
  return (
    <button
      type="button"
      className={`composer-trigger ${active ? "active" : ""} ${invalid ? "invalid" : ""}`}
      onClick={onClick}
    >
      {children}
      <ChevronDown size={14} />
    </button>
  );
}
function Panel({ title, children, wide = false }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`composer-popover ${wide ? "wide" : ""}`} role="dialog" aria-label={title}>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
function ModelList({
  models,
  value,
  onChange,
}: {
  models: CreationModelCapability[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="composer-model-list">
      {models.map((model) => (
        <button
          type="button"
          key={model.id}
          disabled={!model.enabled}
          onClick={() => onChange(model.id)}
          className={value === model.id ? "selected" : ""}
        >
          <span>
            <b>{model.displayName}</b>
            {model.badges.map((item) => (
              <em key={item}>{item}</em>
            ))}
            {model.executionMode === "mock" && <em className="mock">Mock</em>}
            <small>{model.description}</small>
            {!model.enabled && <small className="disabled-reason">{model.disabledReason}</small>}
          </span>
          {value === model.id && <Check size={17} />}
        </button>
      ))}
    </div>
  );
}
function Segments({
  items,
  value,
  onChange,
  isDisabled,
}: {
  items: Array<string | number>;
  value: string | number;
  onChange: (value: string) => void;
  isDisabled?: (value: string) => string | undefined;
}) {
  return (
    <div className="composer-segments">
      {items.map((item) => {
        const reason = isDisabled?.(String(item));
        return (
          <button
            type="button"
            key={item}
            className={String(value) === String(item) ? "selected" : ""}
            disabled={Boolean(reason)}
            title={reason}
            onClick={() => onChange(String(item))}
          >
            {item === "adaptive" ? "自动" : item}
            {reason && <span>{reason}</span>}
          </button>
        );
      })}
    </div>
  );
}
function seedValue() {
  return String(Math.floor(Math.random() * 2147483646) + 1);
}
function assetKind(mimeType: string) {
  return mimeType.startsWith("image/")
    ? "图片"
    : mimeType.startsWith("video/")
      ? "视频"
      : mimeType.startsWith("audio/")
        ? "音频"
        : "素材";
}
function nextAssetLabel(references: AssetRef[], mimeType: string) {
  const kind = assetKind(mimeType);
  return `${kind}${references.filter((item) => assetKind(item.mimeType) === kind).length + 1}`;
}

export function AiCreationComposer() {
  const { data } = useQuery({
    queryKey: ["creation-capabilities"],
    queryFn: fetchCreationCapabilities,
    staleTime: 60_000,
  });
  const models = data?.models ?? [];
  const imageModels = models.filter((item) => item.kind === "image"),
    videoModels = models.filter((item) => item.kind === "video");
  const [kind, setKind] = useState<"image" | "video">("image");
  const [panel, setPanel] = useState<OpenPanel>("type");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showReview, setShowReview] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Job | null>(null);
  const [actionNotice, setActionNotice] = useState("");
  const [imageDraft, setImageDraft] = useState<Draft>(() => ({
    prompt: "",
    modelId: "",
    ratio: "4:3",
    resolution: "2k",
    count: 1,
    seed: "",
    references: [],
    referenceMode: "",
    duration: 5,
    manualConfirm: false,
  }));
  const [videoDraft, setVideoDraft] = useState<Draft>(() => ({
    prompt: "",
    modelId: "",
    ratio: "9:16",
    resolution: "720p",
    count: 1,
    seed: "",
    references: [],
    referenceMode: "omni",
    duration: 5,
    manualConfirm: false,
  }));
  const draft = kind === "image" ? imageDraft : videoDraft;
  const setDraft = kind === "image" ? setImageDraft : setVideoDraft;
  const model = models.find((item) => item.id === draft.modelId && item.kind === kind);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const requestKey = useRef(randomUuid());
  const { data: tasks = [] } = useQuery({
    queryKey: ["api-tasks", "ai-generate"],
    queryFn: () => fetchJobs("ai-generate"),
    refetchInterval: 3000,
  });
  useEffect(() => {
    const saved = localStorage.getItem("yaozuo:ai-composer:v2");
    if (saved)
      try {
        const parsed = JSON.parse(saved) as { image?: Draft; video?: Draft };
        if (parsed.image) setImageDraft(parsed.image);
        if (parsed.video) setVideoDraft(parsed.video);
      } catch {
        /* ignore stale draft */
      }
  }, []);
  useEffect(() => {
    if (!models.length) return;
    setImageDraft((current) =>
      imageModels.some((item) => item.id === current.modelId)
        ? current
        : { ...current, modelId: imageModels.find((item) => item.isDefault && item.enabled)?.id ?? "" },
    );
    setVideoDraft((current) =>
      videoModels.some((item) => item.id === current.modelId)
        ? current
        : { ...current, modelId: videoModels.find((item) => item.isDefault && item.enabled)?.id ?? "" },
    );
  }, [models]);
  useEffect(() => {
    const timer = setTimeout(
      () => localStorage.setItem("yaozuo:ai-composer:v2", JSON.stringify({ image: imageDraft, video: videoDraft })),
      250,
    );
    return () => clearTimeout(timer);
  }, [imageDraft, videoDraft]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const quote = model ? model.pricing.baseCredits + Math.max(0, draft.count - 1) * model.pricing.perOutputCredits : 0;
  const dimensions = model?.dimensions?.[draft.resolution]?.[draft.ratio];
  const referenceTokens = useMemo(() => new Set(draft.references.map((item) => `@${item.label}`)), [draft.references]);
  const unresolved = [...draft.prompt.matchAll(/@(图片|视频|音频|人像)\d+/g)]
    .map((item) => item[0])
    .filter((item) => !referenceTokens.has(item));
  const unsupportedLibrary = kind === "video" && draft.references.some((item) => item.source !== "upload");
  const validate = () => {
    if (!model?.enabled) return "所选模型当前不可用";
    if (!draft.prompt.trim()) return "请输入创意描述";
    if (unresolved.length) return `${unresolved[0]} 未关联到当前素材`;
    if (unsupportedLibrary) return "真实视频任务只能使用已安全上传的本地素材";
    return "";
  };
  const switchKind = (next: "image" | "video") => {
    setKind(next);
    setPanel(null);
    setError("");
    requestKey.current = randomUuid();
  };
  const addDemo = (source: "library" | "portrait") => {
    const mimeType = "image/png";
    update({
      references: [
        ...draft.references,
        {
          id: `library-${source}-${Date.now()}`,
          name: source === "portrait" ? "自然讲解员·宁宁" : "灵感商品图",
          mimeType,
          label: nextAssetLabel(draft.references, mimeType),
          source,
        },
      ],
    });
    setPanel(null);
  };
  const doSubmit = async () => {
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    if (kind === "video" && draft.manualConfirm && !showReview) {
      setShowReview(true);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const values = {
        type: kind === "image" ? "图片" : "视频",
        creationKind: kind,
        prompt: draft.prompt.trim(),
        modelId: draft.modelId,
        ratio: draft.ratio,
        resolution: draft.resolution,
        count: String(draft.count),
        seed: draft.seed,
        referenceMode: draft.referenceMode,
        duration: String(draft.duration),
        references: `assets:${JSON.stringify(draft.references)}`,
      };
      await submitJob(
        "ai-generate",
        `${kind === "image" ? "图片" : "视频"}创作 · ${new Date().toLocaleTimeString()}`,
        values,
        kind === "video" ? (draft.modelId as SeedanceModelId) : undefined,
        requestKey.current,
      );
      requestKey.current = randomUuid();
      setShowReview(false);
      toast.success(kind === "video" ? "视频任务已提交，可在下方查看状态" : "创作任务已提交");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "任务提交失败");
    } finally {
      setSubmitting(false);
    }
  };
  const resultAction = async (action: string) => {
    if (!selectedTask) return;
    const artifact = selectedTask.result?.artifacts?.[0];
    if (action === "下载") {
      if (artifact?.url) await downloadAuthenticated(artifact.url, artifact.name);
      else {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(
          new Blob([artifact?.text ?? selectedTask.result?.summary ?? ""], {
            type: artifact?.mimeType ?? "text/plain",
          }),
        );
        link.download = artifact?.name ?? "ai-creation-result.txt";
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }
      toast.success("已开始下载");
      return;
    }
    if (action === "收藏作品") {
      setActionNotice("作品已收藏");
      toast.success("作品已收藏");
      return;
    }
    const sourcePrompt = selectedTask.values.prompt ?? "";
    setKind(selectedTask.values.creationKind === "video" ? "video" : "image");
    if (selectedTask.values.creationKind === "video")
      setVideoDraft((current) => ({
        ...current,
        prompt: action === "创建变体" ? `${sourcePrompt}\n生成一个构图和节奏不同的变体` : sourcePrompt,
      }));
    else
      setImageDraft((current) => ({
        ...current,
        prompt: action === "创建变体" ? `${sourcePrompt}\n生成一个构图和风格不同的变体` : sourcePrompt,
      }));
    setSelectedTask(null);
    promptRef.current?.focus();
    toast.success(action === "创建变体" ? "已带入变体指令" : "已恢复上一轮提示词");
  };
  const open = (next: OpenPanel) => setPanel((current) => (current === next ? null : next));
  return (
    <main
      className="creation-page"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setPanel(null);
      }}
    >
      <header className="creation-heading">
        <span>AI 工具箱</span>
        <h1>AI 创作</h1>
        <p>输入一个想法，用图片或视频模型把它变成作品。</p>
      </header>
      <section
        className="creation-composer-card"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setPanel(null);
            promptRef.current?.focus();
          }
        }}
      >
        <div className="composer-input-area">
          <div className="reference-wrap">
            <button
              type="button"
              className={`reference-card ${panel === "reference" ? "active" : ""}`}
              onClick={() => open("reference")}
              aria-label={kind === "image" ? "添加参考" : "添加参考素材"}
            >
              <span>+</span>
              {kind === "video" && <small>参考</small>}
            </button>
            {panel === "reference" && (
              <Panel title="添加参考">
                <div className="reference-menu">
                  <AttachmentPicker
                    multiple
                    trigger={(openPicker) => (
                      <button type="button" onClick={openPicker}>
                        <Library />
                        附件素材<small>从素材库选择或从本地上传</small>
                      </button>
                    )}
                    onSelect={(assets) => {
                      const references = [...draft.references];
                      for (const asset of assets) {
                        if (
                          model &&
                          !model.acceptedReferenceKinds.includes(
                            assetKind(asset.mimeType) === "图片"
                              ? "image"
                              : assetKind(asset.mimeType) === "视频"
                                ? "video"
                                : "audio",
                          )
                        ) {
                          setError("当前模型不支持所选参考素材中的文件格式");
                          return;
                        }
                        references.push({
                          id: asset.id,
                          name: asset.name,
                          mimeType: asset.mimeType,
                          label: nextAssetLabel(references, asset.mimeType),
                          source: asset.source,
                          size: asset.size,
                        });
                      }
                      update({ references });
                      setPanel(null);
                    }}
                  />
                  <button type="button" onClick={() => addDemo("portrait")}>
                    <UserRound />
                    人像库<small>{kind === "video" ? "演示人像不可用于真实提交" : "选择人物参考"}</small>
                  </button>
                </div>
              </Panel>
            )}
          </div>
          <textarea
            ref={promptRef}
            value={draft.prompt}
            onChange={(event) => update({ prompt: event.target.value })}
            placeholder={
              kind === "image"
                ? "请输入创意描述"
                : "使用@快速调用参考内容，例如：@图片1 模仿 @视频1 的动作，音色参考 @音频1"
            }
          />
          <div className="composer-tools">
            <button type="button" disabled title="产品稿未定义该按钮行为">
              <Maximize2 />
            </button>
            {kind === "image" && (
              <button type="button" disabled title="提示词优化能力尚未接入">
                <WandSparkles />
              </button>
            )}
          </div>
          {draft.references.length > 0 && (
            <div className="reference-chips">
              {draft.references.map((asset, index) => (
                <span
                  key={`${asset.id}-${index}`}
                  className={asset.source !== "upload" && kind === "video" ? "warning" : ""}
                >
                  <Image />
                  <b>@{asset.label}</b>
                  <small>{asset.name}</small>
                  <button
                    type="button"
                    aria-label={`删除 ${asset.label}`}
                    onClick={() =>
                      update({ references: draft.references.filter((_, itemIndex) => itemIndex !== index) })
                    }
                  >
                    <X />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        <footer className="composer-footer">
          <div className="composer-controls">
            <div className="control-wrap">
              <Trigger active={panel === "type"} onClick={() => open("type")}>
                {kind === "image" ? <Image /> : <Video />}
                {kind === "image" ? "图片生成" : "视频生成"}
              </Trigger>
              {panel === "type" && (
                <Panel title="创作类型">
                  <div className="simple-menu">
                    <button className={kind === "image" ? "selected" : ""} onClick={() => switchKind("image")}>
                      <Image />
                      图片生成{kind === "image" && <Check />}
                    </button>
                    <button className={kind === "video" ? "selected" : ""} onClick={() => switchKind("video")}>
                      <Video />
                      视频生成{kind === "video" && <Check />}
                    </button>
                  </div>
                </Panel>
              )}
            </div>
            <div className="control-wrap">
              <Trigger active={panel === "model"} onClick={() => open("model")}>
                {model?.displayName ?? "加载模型"}
              </Trigger>
              {panel === "model" && (
                <Panel title="选择模型" wide>
                  <ModelList
                    models={kind === "image" ? imageModels : videoModels}
                    value={draft.modelId}
                    onChange={(id) => {
                      update({ modelId: id });
                      setPanel(null);
                    }}
                  />
                </Panel>
              )}
            </div>
            {kind === "video" && (
              <div className="control-wrap">
                <Trigger
                  active={panel === "referenceMode"}
                  invalid={!model?.referenceModes.includes(draft.referenceMode)}
                  onClick={() => open("referenceMode")}
                >
                  {referenceModes.find((item) => item.id === draft.referenceMode)?.label}
                </Trigger>
                {panel === "referenceMode" && (
                  <Panel title="参考模式">
                    <div className="simple-menu">
                      {referenceModes.map((item) => {
                        const disabled = !model?.referenceModes.includes(item.id);
                        return (
                          <button
                            key={item.id}
                            disabled={disabled}
                            className={draft.referenceMode === item.id ? "selected" : ""}
                            title={disabled ? "当前模型能力尚未验证" : ""}
                            onClick={() => {
                              update({ referenceMode: item.id });
                              setPanel(null);
                            }}
                          >
                            {item.label}
                            {item.badge && <em>{item.badge}</em>}
                            {disabled ? <small>暂未验证</small> : draft.referenceMode === item.id && <Check />}
                          </button>
                        );
                      })}
                    </div>
                  </Panel>
                )}
              </div>
            )}
            <div className="control-wrap">
              <Trigger active={panel === "size"} onClick={() => open("size")}>
                {draft.ratio === "adaptive" ? "自动" : draft.ratio}　
                {kind === "image" ? (draft.resolution === "2k" ? "高清2K" : "普通1K") : draft.resolution.toUpperCase()}
              </Trigger>
              {panel === "size" && (
                <Panel title={kind === "image" ? "图片尺寸" : "视频画幅与清晰度"} wide>
                  <label>选择比例</label>
                  <Segments
                    items={kind === "image" ? imageRatios : videoRatios}
                    value={draft.ratio}
                    onChange={(ratio) => update({ ratio })}
                    isDisabled={(value) => (model && !model.supportedRatios.includes(value) ? "模型不支持" : undefined)}
                  />
                  <label>选择分辨率</label>
                  <Segments
                    items={kind === "image" ? ["1k", "2k"] : videoResolutions}
                    value={draft.resolution}
                    onChange={(resolution) => update({ resolution })}
                    isDisabled={(value) =>
                      model && !model.supportedResolutions.includes(value) ? "暂未验证" : undefined
                    }
                  />
                  {kind === "image" && dimensions && (
                    <>
                      <label>尺寸</label>
                      <div className="dimension-readout">
                        <span>
                          W <b>{dimensions.width} px</b>
                        </span>
                        <span>
                          H <b>{dimensions.height} px</b>
                        </span>
                      </div>
                    </>
                  )}
                </Panel>
              )}
            </div>
            <div className="control-wrap">
              <Trigger active={panel === "count"} onClick={() => open("count")}>
                {kind === "video" ? `${draft.duration}s　${draft.count}个` : `${draft.count}张`}
              </Trigger>
              {panel === "count" && (
                <Panel title={kind === "image" ? "生成数量" : "时长与数量"} wide>
                  {kind === "video" && (
                    <>
                      <label>生成视频时长(秒)</label>
                      <Segments
                        items={Array.from({ length: 12 }, (_, i) => i + 4)}
                        value={draft.duration}
                        onChange={(duration) => update({ duration: Number(duration) })}
                        isDisabled={(value) =>
                          model && !model.supportedDurations.includes(Number(value)) ? "模型不支持" : undefined
                        }
                      />
                    </>
                  )}
                  <label>{kind === "image" ? "最大生成数量(张)" : "最大生成数量"}</label>
                  <Segments
                    items={Array.from({ length: kind === "image" ? 8 : 4 }, (_, i) => i + 1)}
                    value={draft.count}
                    onChange={(count) => update({ count: Number(count) })}
                    isDisabled={(value) => (model && Number(value) > model.maxOutputs ? "暂未支持" : undefined)}
                  />
                  <label>种子值</label>
                  <div className="seed-input">
                    <input
                      inputMode="numeric"
                      disabled={!model?.supportsSeed}
                      value={draft.seed}
                      placeholder={model?.supportsSeed ? "不填则随机" : "当前模型不支持"}
                      onChange={(event) => update({ seed: event.target.value.replace(/\D/g, "").slice(0, 10) })}
                    />
                    <button
                      type="button"
                      disabled={!model?.supportsSeed}
                      aria-label="随机种子"
                      onClick={() => update({ seed: seedValue() })}
                    >
                      <RefreshCw />
                    </button>
                  </div>
                </Panel>
              )}
            </div>
          </div>
          <div className="composer-submit">
            <span className={kind === "image" ? "credits" : ""}>
              {quote}星点
              <small>{model?.executionMode === "mock" ? "模拟能力，不调用真实图片模型" : "服务端提交时重新报价"}</small>
            </span>
            <button
              type="button"
              aria-label="提交创作"
              disabled={submitting || !model?.enabled}
              onClick={() => void doSubmit()}
            >
              {submitting ? <LoaderCircle className="spin" /> : <ArrowUp />}
            </button>
          </div>
        </footer>
        {error && <div className="composer-error">{error}</div>}
      </section>
      {kind === "video" && (
        <label className="manual-confirm">
          <input
            type="checkbox"
            checked={draft.manualConfirm}
            onChange={(event) => update({ manualConfirm: event.target.checked })}
          />
          提交前手动确认
        </label>
      )}
      <section className="creation-tasks">
        <header>
          <div>
            <span>任务中心</span>
            <h2>最近创作</h2>
          </div>
          <small>{tasks.length} 个任务</small>
        </header>
        {tasks.length ? (
          <div className="creation-task-table">
            <table>
              <thead>
                <tr>
                  <th>执行</th>
                  <th>任务名称</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.slice(0, 8).map((task: Job) => (
                  <tr key={task.id}>
                    <td>
                      <span className={`task-kind ${task.overallExecutionMode}`}>
                        {task.overallExecutionMode === "real"
                          ? "真实"
                          : task.overallExecutionMode === "mock"
                            ? "模拟"
                            : "混合"}
                      </span>
                    </td>
                    <td>
                      <b>{task.title}</b>
                      <small>
                        {task.stage} · {task.progress}%
                      </small>
                    </td>
                    <td>
                      <em>
                        {task.status === "succeeded"
                          ? "已完成"
                          : task.status === "failed"
                            ? "失败"
                            : task.status === "cancelled"
                              ? "已取消"
                              : "进行中"}
                      </em>
                    </td>
                    <td>
                      {task.status === "succeeded" || task.status === "partially_succeeded" ? (
                        <button type="button" onClick={() => setSelectedTask(task)}>
                          查看结果
                        </button>
                      ) : (
                        <span className="task-waiting">{task.status === "failed" ? "可重试" : "处理中"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="creation-empty">
            <Sparkles />
            <b>还没有创作记录</b>
            <span>完成上方配置并提交，任务状态会显示在这里</span>
          </div>
        )}
      </section>
      {actionNotice && (
        <div className="safe-note">
          <Sparkles size={17} />
          <span>
            <b>{actionNotice}</b>
            <small>操作已完成</small>
          </span>
        </div>
      )}
      {showReview && (
        <div className="composer-review-backdrop" onMouseDown={() => setShowReview(false)}>
          <section onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>提交前手动确认</span>
                <h2>确认视频生成参数</h2>
              </div>
              <button aria-label="关闭确认" onClick={() => setShowReview(false)}>
                <X />
              </button>
            </header>
            <dl>
              <div>
                <dt>模型</dt>
                <dd>{model?.displayName}</dd>
              </div>
              <div>
                <dt>画幅</dt>
                <dd>
                  {draft.ratio} · {draft.resolution.toUpperCase()}
                </dd>
              </div>
              <div>
                <dt>时长</dt>
                <dd>{draft.duration} 秒</dd>
              </div>
              <div>
                <dt>预计消耗</dt>
                <dd>{quote} 星点</dd>
              </div>
            </dl>
            <p>确认后将创建真实 Seedance 异步任务。任务可能耗时数分钟，并产生模型费用。</p>
            <button className="confirm-paid" disabled={submitting} onClick={() => void doSubmit()}>
              {submitting ? <LoaderCircle className="spin" /> : null}确认并提交
            </button>
          </section>
        </div>
      )}
      {selectedTask && (
        <div className="result-backdrop" onMouseDown={() => setSelectedTask(null)}>
          <section className="result-drawer" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>生成结果 · {selectedTask.overallExecutionMode === "mock" ? "模拟能力" : "真实生成"}</span>
                <h2>对话作品</h2>
              </div>
              <button aria-label="关闭" onClick={() => setSelectedTask(null)}>
                <X />
              </button>
            </header>
            <div className="creation-result-preview">
              <Sparkles />
              <b>{selectedTask.title}</b>
              <p>{selectedTask.result?.summary ?? "结果已生成，可继续追问或创建变体。"}</p>
            </div>
            <div className="tool-result-actions">
              {["继续追问", "创建变体", "收藏作品", "下载"].map((action, index) => (
                <button key={action} className={index === 0 ? "primary" : ""} onClick={() => void resultAction(action)}>
                  {action}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
