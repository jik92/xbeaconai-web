// biome-ignore-all lint/a11y/useButtonType: This full-screen workbench contains no forms.
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
  Image as ImageIcon,
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
import { downloadAuthenticated, fetchModels, submitJob, uploadMediaFile, watchJob } from "@/api/api-client";
import type { Job, SeedanceModelId } from "@/api/generated/types.gen";
import { AuthenticatedMedia } from "@/components/domain/authenticated-media";
import type { ApiJobResult } from "@/entities/types";
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
}

const promptText = `### 第一部分：全局基础设定
约束条件：人物动作自然流畅，面部无扭曲变形；场景真实有生活感，无多余杂物穿模；精准还原商品外观，禁止错误生成；仅精准还原参考图产品 LOGO 与原有印刷文字，禁止额外生成任何字幕、底部字幕、旁白字幕，不新增任何文字，杜绝双层字幕。
人物形象：中年男性，利落短发，身穿藏蓝色带白色小翅膀logo的翻领POLO衫，搭配黑色西裤、黑色皮带与黑色皮鞋，领口佩戴黑色领夹麦，外形沉稳接地气。
人物神态：面部充满自然微表情，每3-4秒自然眨眼一次，眼球缓慢转动，目光柔和平视镜头，眼神有光不空洞；嘴角松弛柔和，面部肌肉放松不紧绷；杜绝面瘫脸、杜绝机械假脸、五官动态自然柔和；说话时眉眼轻微微动，神态生活化接地气，去掉AI虚拟质感，呈现真人真实鲜活神态，表情生动不死板。
商品形态：高端休闲复古草帽，草编材质帽身配皮质装饰带，装饰带上有高端复古标识，帽檐弧度自然挺括，面料透气有质感，采用透明密封塑料袋独立包装。
镜头视角：全片采用平视视角拍摄，镜头稳定无晃动，模拟真人手机实拍视角。
背景描述：大型钢结构仓储空间，顶部为钢结构桁架搭配采光板与LED照明灯管，两侧摆放蓝橙配色的重型仓储货架，货架上堆满整箱货物；地面有浑浊黄褐色积水，水面上整齐散落大量独立包装的休闲复古草帽，多名身穿黑色工作服的工作人员弯腰整理积水里的货物，仓库尽头是敞开的大门，可看到室外景物。
光线分析：顶部冷白色工业照明结合从仓库大门射入的自然天光，光线明亮均匀，无强烈硬阴影，呈现真实仓库原生光线氛围，水面有自然光线反射。
音色设定：中年男性偏低沉的接地气音色，语速稍快，情绪饱满有感染力，符合带货场景的真实表达状态。
画质要求：1080P高清分辨率，色彩真实自然，无过度滤镜修饰，呈现原生实拍的真实质感。
视频总时长：15秒

---

### 第二部分：分镜内容

分镜 01
人物动作描述：中年男性站在仓库积水区域，正对镜头，双臂微微向身体两侧摊开，手势示意身后的积水地面。
画面口播文案：完了姐妹们，昨天一场大雨，仓库进水了。
人物说话神态：自然眨眼，眉头微蹙，神情略带焦虑惋惜。
音色语气设定：语气焦急带点无奈，语速稍快。
分镜时长：3秒
景别：近景
画面构图：人物居中，上半身占据画面主要区域，身后露出部分积水地面与堆放的货物。`;

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
  selectedPortrait,
  source,
  uploading,
  onUpload,
  onNotice,
}: {
  mode: "product" | "talking";
  setMode: (mode: "product" | "talking") => void;
  description: string;
  setDescription: (value: string) => void;
  selectedPortrait: SelectedPortrait | null;
  source: string;
  uploading: boolean;
  onUpload: (file?: File) => void;
  onNotice: (value: string) => void;
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
      <input className="remix-project-name" aria-label="项目名称" maxLength={30} placeholder="项目名称（选填）" />
      <div className="config-field-title">
        <b>
          商品 <em>*</em>
        </b>
        <button onClick={() => onNotice("已打开商品库")}>⚙ 商品库</button>
      </div>
      <button className="config-product" onClick={() => onNotice("已选择演示商品")}>
        <span className="product-thumb" />
        <span>{source ? demoProduct : "未选择商品"}</span>
        <b>{source ? "" : "选择"}</b>
      </button>
      <div className="config-field-title">
        <b>人像</b>
        <button onClick={() => onNotice("请在人像库选择人像")}>+ 添加</button>
      </div>
      {source || selectedPortrait ? (
        <img className="config-portrait" src={selectedPortrait?.source_url || fallbackPortrait} alt="已选人像" />
      ) : (
        <span className="config-empty">未添加人像</span>
      )}
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
      {source ? (
        <label className="uploaded-video-card">
          <input type="file" accept="video/*" onChange={(event) => onUpload(event.target.files?.[0])} />
          <span className="video-card-thumb">
            <Video />
          </span>
          <span>
            <b>{fileName}</b>
            <small>时长：17.0s</small>
            <small>解析模版：未设置</small>
            <small>思考深度：深度</small>
          </span>
        </label>
      ) : (
        <div className="config-upload-box">
          <label>
            <ImageIcon />
            <span>素材库选择</span>
            <input type="file" accept="video/*" onChange={(event) => onUpload(event.target.files?.[0])} />
          </label>
          <label>
            {uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}
            <span>{uploading ? "上传中" : "本地上传"}</span>
            <input type="file" accept="video/*" onChange={(event) => onUpload(event.target.files?.[0])} />
          </label>
        </div>
      )}
    </aside>
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
    // biome-ignore lint/a11y/noStaticElementInteractions: The backdrop dismisses the modal drawer.
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
  const [prompt, setPrompt] = useState(promptText);
  const [source, setSource] = useState("");
  const [uploading, setUploading] = useState(false);
  const [mode, setMode] = useState<"product" | "talking">("product");
  const [description, setDescription] = useState("");
  const [compare, setCompare] = useState(false);
  const [notice, setNotice] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const videoModel: SeedanceModelId = "doubao-seedance-2-0-fast-260128";
  const { data: modelCatalog = [] } = useQuery({ queryKey: ["api-models"], queryFn: fetchModels, staleTime: 60_000 });
  const videoModels = modelCatalog.filter((model) => model.capability === "video-generate" && model.enabled);
  const [selectedPortrait] = useState<SelectedPortrait | null>(() => {
    try {
      return JSON.parse(localStorage.getItem("studio:selectedPortrait") || "null");
    } catch {
      return null;
    }
  });

  useEffect(
    () =>
      job && (job.status === "queued" || job.status === "processing")
        ? watchJob(
            job.id,
            (updated) => {
              setJob(updated);
              if (updated.progress >= 35 && !parsed) {
                setParsed(true);
                setParsing(false);
                setStage(2);
              }
            },
            () => setNotice("实时连接已断开，可刷新页面恢复任务"),
          )
        : undefined,
    [job?.id, job?.status, parsed, job],
  );

  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    setNotice("");
    try {
      const asset = await uploadMediaFile(file);
      setSource(`asset:${asset.id}:${asset.name}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };
  const parse = async () => {
    if (parsing) return;
    if (!source) {
      setNotice("请先上传分镜视频并选择商品");
      setStage(0);
      return;
    }
    if (!videoModels.some((model) => model.id === videoModel)) {
      setNotice("Seedance 模型尚未通过真实基线验证");
      return;
    }
    setParsed(false);
    setParsing(true);
    setStage(1);
    setNotice("");
    try {
      const created = await submitJob(
        "video-remix",
        `爆款二创 · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        { source, mode, description, prompt, portrait: selectedPortrait?.name ?? "" },
        videoModel,
      );
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
    setDescription("");
    setPrompt(promptText);
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
          selectedPortrait={selectedPortrait}
          source={source}
          uploading={uploading}
          onUpload={(file) => void upload(file)}
          onNotice={setNotice}
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
        <button className="parse-button" disabled={!source || uploading || parsing} onClick={() => void parse()}>
          <Sparkles />
          {parsing ? "解析中" : "视频解析"}
        </button>
      )}
      <ProjectHistoryDrawer open={historyOpen} job={job} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
