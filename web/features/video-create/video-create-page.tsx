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
import { useEffect, useMemo, useState } from "react";
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
  const [advanced, setAdvanced] = useState(false);
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

          <button className="vc-collapse" onClick={() => setAdvanced((value) => !value)}>
            <span>广告诉求 · 脚本风格 · 高级设置</span>
            <ChevronDown className={advanced ? "open" : ""} />
          </button>
          {advanced && (
            <div className="vc-advanced">
              <label>
                广告诉求
                <textarea
                  value={input.requirements}
                  onChange={(event) => mutateInput("requirements", event.target.value)}
                  placeholder="目标人群、投放目标和表达要求"
                />
              </label>
              <label>
                脚本风格
                <input value={input.scriptStyle} onChange={(event) => mutateInput("scriptStyle", event.target.value)} />
              </label>
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
              <div className="vc-advanced-field">
                配音音色
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
            </div>
          )}
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
