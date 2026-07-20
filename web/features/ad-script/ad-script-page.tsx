import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Copy,
  Download,
  FileSearch,
  LoaderCircle,
  MapPin,
  Minus,
  Pencil,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createAdScript,
  downloadAdScriptVersion,
  fetchAdScriptProject,
  fetchJob,
  parseExistingAdScript,
  requestCancel,
  runAdScriptAction,
  saveAdScriptHumanVersion,
  watchJob,
} from "@/api/api-client";
import type { AdScriptInput, AdScriptProject, AdScriptVariant, Job } from "@/api/generated/types.gen";
import { useAuth } from "@/features/account/auth-context";
import "./ad-script-page.css";

const scenes = {
  marketing: [
    ["content-seeding", "内容种草", "生活场景植入 · 真实感种草", "150-200"],
    ["short-video-sales", "短视频带货", "黄金 3 秒钩子 · 痛点爆破", "150-200"],
    ["live-traffic", "引流直播间", "福利驱动 · 紧迫稀缺", "80-120"],
    ["live-sales", "直播带货", "即时促单 · 信任背书", "100-150"],
    ["brand-awareness", "品牌曝光", "品牌记忆点 · 视觉冲击", "60-80"],
    ["commerce-conversion", "商城转化", "价格锚点 · 限时促销", "100-150"],
    ["local-store", "本地到店", "地域感知 · 到店利益", "80-120"],
    ["lead-generation", "线索收集", "痛点激发 · 专业背书", "100-150"],
  ],
  placement: [
    ["feed-ad", "信息流广告", "黄金 3 秒钩子 · 情感共鸣", "150-200"],
    ["search-ad", "搜索广告", "关键词植入 · 意图匹配", "100-150"],
    ["brand-ad", "品牌广告", "视觉冲击 · 品牌声量", "60-80"],
  ],
} as const;

const roles = [
  ["好物推荐员", "亲切推荐，真实种草"],
  ["KOL 达人", "专业背书，权威可信"],
  ["普通用户", "素人真实感受"],
  ["行业专家", "专业术语，科学说服"],
  ["品牌官方", "官方口吻，安全合规"],
  ["自定义角色", "自由设定角色背景"],
] as const;
const styles = ["种草口吻", "专业测评", "情绪共鸣", "悬念钩子", "故事叙述", "数据说话"];
const goals = ["品牌曝光", "App 下载", "电商转化", "门店到店", "直播引流"];
const lengths: AdScriptInput["targetLength"][] = ["60-80", "80-120", "100-150", "150-200", "200-250", "250-350"];
const draftKey = "fenghuo:ad-script:draft:v2";
const activeProjectKey = "fenghuo:ad-script:active-project:v1";

const defaultInput: AdScriptInput = {
  sceneCategory: "marketing",
  sceneId: "content-seeding",
  batchCount: 1,
  productName: "",
  sellingPoints: [],
  targetLength: "150-200",
  marketingGoal: "品牌曝光",
  targetAudience: "",
  painPoints: "",
  benefits: "",
  speakerRole: "好物推荐员",
  customRole: "",
  scriptStyle: "种草口吻",
  openingStyle: "痛点直击",
  sourceScript: "",
  useSourceAsReference: false,
};

function loadDraft(): AdScriptInput {
  try {
    return { ...defaultInput, ...(JSON.parse(localStorage.getItem(draftKey) ?? "null") ?? {}) };
  } catch {
    return defaultInput;
  }
}

function messageOf(error: unknown) {
  if (error && typeof error === "object" && "error" in error) {
    const value = (error as { error?: { message?: string } }).error?.message;
    if (value) return value;
  }
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

function currentVersion(variant: AdScriptVariant | undefined) {
  return variant?.versions.find((version) => version.id === variant.currentVersionId) ?? variant?.versions.at(-1);
}

function trackJob(jobId: string, onChange: (job: Job) => void) {
  let completed = false;
  let stopSse: () => void = () => undefined;
  let timer = 0;
  const cleanup = () => {
    stopSse();
    window.clearInterval(timer);
  };
  const apply = (job: Job) => {
    onChange(job);
    if (["succeeded", "partially_succeeded", "failed", "cancelled"].includes(job.status)) {
      completed = true;
      cleanup();
    }
  };
  stopSse = watchJob(jobId, apply);
  timer = window.setInterval(() => {
    if (completed) return;
    void fetchJob(jobId)
      .then(apply)
      .catch(() => undefined);
  }, 2_000);
  return cleanup;
}

export function AdScriptPage() {
  const { refresh: refreshUser } = useAuth();
  const restoredProjectId = localStorage.getItem(activeProjectKey) ?? "";
  const [input, setInput] = useState<AdScriptInput>(loadDraft);
  const [step, setStep] = useState(0);
  const [screen, setScreen] = useState<"form" | "progress" | "result">(restoredProjectId ? "progress" : "form");
  const [projectId, setProjectId] = useState(restoredProjectId);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [editor, setEditor] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [extracted, setExtracted] = useState<Partial<AdScriptInput>>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actionJob, setActionJob] = useState<Job>();

  const projectQuery = useQuery({
    queryKey: ["ad-script-project", projectId],
    queryFn: () => fetchAdScriptProject(projectId),
    enabled: Boolean(projectId),
    refetchInterval: (query) => {
      const status = query.state.data?.project.status;
      return status && ["succeeded", "partially_succeeded", "failed", "cancelled"].includes(status) ? false : 1_500;
    },
  });
  const project = projectQuery.data;

  useEffect(() => {
    localStorage.setItem(draftKey, JSON.stringify(input));
  }, [input]);
  useEffect(() => {
    if (projectId) localStorage.setItem(activeProjectKey, projectId);
    else localStorage.removeItem(activeProjectKey);
  }, [projectId]);
  useEffect(() => {
    if (
      project?.project.status &&
      ["succeeded", "partially_succeeded", "failed", "cancelled"].includes(project.project.status)
    )
      void refreshUser();
  }, [project?.project.status, refreshUser]);
  useEffect(() => {
    if (!project) return;
    const firstSucceeded = project.variants.find((variant) => variant.status === "succeeded");
    if (firstSucceeded && ["succeeded", "partially_succeeded"].includes(project.project.status)) {
      setSelectedVariantId((value) => value || firstSucceeded.id);
      setScreen("result");
    }
  }, [project]);

  const selectedVariant = project?.variants.find((variant) => variant.id === selectedVariantId) ?? project?.variants[0];
  const selectedVersion =
    selectedVariant?.versions.find((version) => version.id === selectedVersionId) ?? currentVersion(selectedVariant);
  const selectedVersionEditorId = selectedVersion?.id;
  const selectedVersionEditorScript = selectedVersion?.script;
  useEffect(() => {
    if (!selectedVersionEditorId || !selectedVersionEditorScript) return;
    setSelectedVersionId(selectedVersionEditorId);
    setEditor(selectedVersionEditorScript);
  }, [selectedVersionEditorId, selectedVersionEditorScript]);

  const validStep = useMemo(() => {
    if (step === 0) return Boolean(input.sceneId);
    if (step === 1)
      return Boolean(
        input.productName.trim() && input.sellingPoints.length && input.targetAudience.trim() && input.marketingGoal,
      );
    return Boolean(
      input.speakerRole &&
        input.scriptStyle &&
        input.openingStyle &&
        (input.speakerRole !== "自定义角色" || input.customRole?.trim()),
    );
  }, [input, step]);

  const update = <K extends keyof AdScriptInput>(key: K, value: AdScriptInput[K]) =>
    setInput((current) => ({ ...current, [key]: value }));

  const parseSource = async () => {
    if ((input.sourceScript?.trim().length ?? 0) < 20) return setError("请至少粘贴 20 个字的已有脚本");
    setBusy("parse");
    setError("");
    try {
      const job = await parseExistingAdScript(input.sourceScript ?? "");
      trackJob(job.id, (next) => {
        if (next.status === "succeeded") {
          try {
            const artifact = next.result?.artifacts.find((item) => item.mimeType === "application/json");
            setExtracted(JSON.parse(artifact?.text ?? "{}") as Partial<AdScriptInput>);
          } catch {
            setError("解析结果格式无效");
          }
          setBusy("");
        } else if (["failed", "cancelled"].includes(next.status)) {
          setError(next.error?.message ?? "已有脚本解析失败");
          setBusy("");
        }
      });
    } catch (cause) {
      setError(messageOf(cause));
      setBusy("");
    }
  };

  const applyExtracted = () => {
    if (!extracted) return;
    setInput((current) => ({
      ...current,
      productName: extracted.productName || current.productName,
      sellingPoints: extracted.sellingPoints?.length ? extracted.sellingPoints : current.sellingPoints,
      marketingGoal: extracted.marketingGoal || current.marketingGoal,
      targetAudience: extracted.targetAudience || current.targetAudience,
      painPoints: extracted.painPoints || current.painPoints,
      benefits: extracted.benefits || current.benefits,
    }));
    setExtracted(undefined);
    setNotice("解析结果已填入，请确认后继续");
  };

  const generate = async () => {
    setBusy("generate");
    setError("");
    try {
      const created = await createAdScript(input);
      setProjectId(created.project.id);
      setScreen("progress");
      localStorage.removeItem(draftKey);
      await refreshUser();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy("");
    }
  };

  const saveEditor = async () => {
    if (!project || !selectedVariant || !selectedVersion) return;
    setBusy("save");
    setError("");
    try {
      const updated = await saveAdScriptHumanVersion({
        projectId: project.project.id,
        variantId: selectedVariant.id,
        expectedVersionId: selectedVersion.id,
        script: editor,
      });
      await projectQuery.refetch();
      const variant = updated.variants.find((item) => item.id === selectedVariant.id);
      if (variant?.currentVersionId) setSelectedVersionId(variant.currentVersionId);
      setNotice("人工修订版本已保存");
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy("");
    }
  };

  const runAction = async (action: "rescore" | "continue") => {
    if (!project || !selectedVariant || !selectedVersion) return;
    setBusy(action);
    setError("");
    try {
      const job = await runAdScriptAction({
        projectId: project.project.id,
        variantId: selectedVariant.id,
        versionId: selectedVersion.id,
        action,
      });
      setActionJob(job);
      trackJob(job.id, (next) => {
        setActionJob(next);
        if (["succeeded", "partially_succeeded"].includes(next.status)) {
          setSelectedVersionId("");
          void projectQuery.refetch();
          setBusy("");
          setNotice(action === "rescore" ? "重新评分完成" : "继续调优完成");
        } else if (["failed", "cancelled"].includes(next.status)) {
          setBusy("");
          setError(next.error?.message ?? "操作失败");
        }
      });
    } catch (cause) {
      setBusy("");
      setError(messageOf(cause));
    }
  };

  const cancelGeneration = async () => {
    if (!project?.project.jobId) return;
    setBusy("cancel");
    setError("");
    try {
      await requestCancel(project.project.jobId);
      await projectQuery.refetch();
      await refreshUser();
      setNotice("任务已取消；按计费规则不退还创作点");
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy("");
    }
  };

  const regenerate = async () => {
    if (!project || !window.confirm(`重新生成将再次消耗 ${project.project.input.batchCount * 20} 创作点，是否继续？`))
      return;
    setBusy("regenerate");
    setError("");
    try {
      const created = await createAdScript(project.project.input);
      setProjectId(created.project.id);
      setSelectedVariantId("");
      setSelectedVersionId("");
      setScreen("progress");
      await refreshUser();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy("");
    }
  };

  if (screen === "progress")
    return (
      <ProgressScreen
        project={project}
        error={error || (projectQuery.error ? messageOf(projectQuery.error) : "")}
        onBack={() => setScreen("form")}
        onCancel={() => void cancelGeneration()}
        cancelling={busy === "cancel"}
      />
    );
  if (screen === "result" && project && selectedVariant && selectedVersion)
    return (
      <ResultScreen
        project={project}
        selectedVariant={selectedVariant}
        selectedVersionId={selectedVersion.id}
        editor={editor}
        busy={busy}
        actionJob={actionJob}
        error={error}
        notice={notice}
        onEditor={setEditor}
        onVariant={(id) => {
          setSelectedVariantId(id);
          setSelectedVersionId("");
        }}
        onVersion={setSelectedVersionId}
        onSave={() => void saveEditor()}
        onAction={(action) => void runAction(action)}
        onExport={(format) =>
          void downloadAdScriptVersion({
            projectId: project.project.id,
            variantId: selectedVariant.id,
            versionId: selectedVersion.id,
            format,
          }).catch((cause) => setError(messageOf(cause)))
        }
        onReset={() => {
          setInput(project.project.input);
          setProjectId("");
          setScreen("form");
          setStep(0);
        }}
        onRegenerate={() => void regenerate()}
      />
    );

  return (
    <section className="ad-script-page">
      <header className="ad-script-head">
        <div>
          <span className="ad-script-eyebrow">高转化脚本生成器</span>
          <h1>口播脚本</h1>
          <p>从营销场景到合规成稿，用固定 DeepSeek 模型完成多轮评分与调优。</p>
        </div>
        <div className="ad-script-model">
          <Sparkles size={15} /> deepseek/deepseek-v4-pro
        </div>
      </header>
      <nav className="ad-script-steps" aria-label="脚本配置步骤">
        {["选择场景", "广告诉求", "脚本风格"].map((label, index) => (
          <button
            type="button"
            key={label}
            className={step === index ? "active" : step > index ? "done" : ""}
            onClick={() => index < step && setStep(index)}
          >
            <i>{step > index ? <Check size={13} /> : index + 1}</i>
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="ad-script-card">
        {step === 0 && <SceneStep input={input} update={update} />}
        {step === 1 && (
          <ProductStep
            input={input}
            update={update}
            sourceOpen={sourceOpen}
            setSourceOpen={setSourceOpen}
            busy={busy}
            extracted={extracted}
            onParse={() => void parseSource()}
            onApply={applyExtracted}
            onDismiss={() => setExtracted(undefined)}
          />
        )}
        {step === 2 && <StyleStep input={input} update={update} />}
        {(error || notice) && <p className={`ad-script-feedback ${error ? "error" : "success"}`}>{error || notice}</p>}
        <footer className="ad-script-footer">
          {step > 0 && (
            <button type="button" className="secondary" onClick={() => setStep((value) => value - 1)}>
              <ArrowLeft /> 上一步
            </button>
          )}
          <button
            type="button"
            className="primary"
            data-role="ad-script-next"
            disabled={!validStep || Boolean(busy)}
            onClick={() => (step < 2 ? setStep((value) => value + 1) : void generate())}
          >
            {busy === "generate" ? <LoaderCircle className="spin" /> : step === 2 ? <Sparkles /> : null}
            {step === 2 ? `生成脚本 · ${input.batchCount * 20} 创作点` : "下一步"}
            <ArrowRight />
          </button>
        </footer>
      </div>
    </section>
  );
}

function SceneStep({
  input,
  update,
}: {
  input: AdScriptInput;
  update: <K extends keyof AdScriptInput>(key: K, value: AdScriptInput[K]) => void;
}) {
  return (
    <div className="ad-script-section">
      <h2>选择{input.sceneCategory === "marketing" ? "营销" : "投放"}场景</h2>
      <div className="scene-tabs">
        {(["marketing", "placement"] as const).map((category) => (
          <button
            type="button"
            key={category}
            className={input.sceneCategory === category ? "active" : ""}
            onClick={() => {
              update("sceneCategory", category);
              const next = scenes[category][0];
              update("sceneId", next[0]);
              update("targetLength", next[3]);
            }}
          >
            {category === "marketing" ? "营销场景" : "投放场景"}
          </button>
        ))}
      </div>
      <p className="section-note">广告投来干什么？选择目标，AI 自动匹配策略</p>
      <div className="scene-grid">
        {scenes[input.sceneCategory].map(([id, name, description, length]) => (
          <button
            type="button"
            key={id}
            className={input.sceneId === id ? "selected" : ""}
            onClick={() => {
              update("sceneId", id);
              update("targetLength", length);
            }}
          >
            <span className="scene-icon">{id === "local-store" ? <MapPin /> : <Target />}</span>
            <b>{name}</b>
            <small>{description}</small>
            <em>{length}字</em>
          </button>
        ))}
      </div>
      <div className="batch-row">
        <div>
          <b>批量生成 · A/B Test</b>
          <span>同时生成多条差异化变体，便于测试</span>
        </div>
        <div className="counter">
          <button type="button" onClick={() => update("batchCount", Math.max(1, input.batchCount - 1))}>
            <Minus />
          </button>
          <b>{input.batchCount}</b>
          <button type="button" onClick={() => update("batchCount", Math.min(3, input.batchCount + 1))}>
            <Plus />
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductStep({
  input,
  update,
  sourceOpen,
  setSourceOpen,
  busy,
  extracted,
  onParse,
  onApply,
  onDismiss,
}: {
  input: AdScriptInput;
  update: <K extends keyof AdScriptInput>(key: K, value: AdScriptInput[K]) => void;
  sourceOpen: boolean;
  setSourceOpen: (value: boolean) => void;
  busy: string;
  extracted?: Partial<AdScriptInput>;
  onParse: () => void;
  onApply: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="ad-script-section form-section">
      <button type="button" className="source-toggle" onClick={() => setSourceOpen(!sourceOpen)}>
        <FileSearch />
        <b>有现成脚本？一键解析填入</b>
        <span>粘贴脚本，AI 自动提取产品信息</span>
        <ChevronDown className={sourceOpen ? "open" : ""} />
      </button>
      {sourceOpen && (
        <div className="source-panel">
          <textarea
            value={input.sourceScript ?? ""}
            onChange={(event) => update("sourceScript", event.target.value)}
            placeholder="粘贴现有口播脚本或竞品脚本原文…"
          />
          <div>
            <button type="button" className="primary compact" disabled={busy === "parse"} onClick={onParse}>
              {busy === "parse" ? <LoaderCircle className="spin" /> : <Sparkles />} AI 解析
            </button>
            <label>
              <input
                type="checkbox"
                checked={input.useSourceAsReference ?? false}
                onChange={(event) => update("useSourceAsReference", event.target.checked)}
              />{" "}
              同时作为生成灵感参考
            </label>
          </div>
        </div>
      )}
      {extracted && (
        <div className="extract-review">
          <b>解析结果待确认</b>
          <p>
            {extracted.productName || "未识别产品名"} · {extracted.sellingPoints?.join("、") || "未识别卖点"}
          </p>
          <div>
            <button type="button" onClick={onDismiss}>
              忽略
            </button>
            <button type="button" className="primary compact" onClick={onApply}>
              <Check /> 确认填入
            </button>
          </div>
        </div>
      )}
      <div className="selected-scene">
        <MapPin />
        <div>
          <b>{scenes[input.sceneCategory].find(([id]) => id === input.sceneId)?.[1]}</b>
          <span>{scenes[input.sceneCategory].find(([id]) => id === input.sceneId)?.[2]}</span>
        </div>
        <em>{input.targetLength}字</em>
      </div>
      <label className="field">
        <span>
          产品名称 <i>*</i>
        </span>
        <input
          value={input.productName}
          maxLength={30}
          onChange={(event) => update("productName", event.target.value)}
          placeholder="例如：玻尿酸精华液 / 小米 14 Pro"
        />
        <small>{input.productName.length} / 30</small>
      </label>
      <label className="field">
        <span>
          产品卖点 <i>*</i>
          <em>每行一个，最多 6 条</em>
        </span>
        <textarea
          value={input.sellingPoints.join("\n")}
          onChange={(event) =>
            update(
              "sellingPoints",
              event.target.value
                .split("\n")
                .map((item) => item.trim())
                .filter(Boolean)
                .slice(0, 6),
            )
          }
          placeholder="输入卖点，每行一个…"
        />
        <small>{input.sellingPoints.length} / 6 条</small>
      </label>
      <div className="field">
        <span>文案字数</span>
        <div className="pill-group">
          {lengths.map((length) => (
            <button
              type="button"
              key={length}
              className={input.targetLength === length ? "active" : ""}
              onClick={() => update("targetLength", length)}
            >
              {length}字
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>
          营销目标 <i>*</i>
        </span>
        <div className="pill-group">
          {goals.map((goal) => (
            <button
              type="button"
              key={goal}
              className={input.marketingGoal === goal ? "active" : ""}
              onClick={() => update("marketingGoal", goal)}
            >
              {goal}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>
          目标用户 <i>*</i>
        </span>
        <input
          value={input.targetAudience}
          onChange={(event) => update("targetAudience", event.target.value)}
          placeholder="例如：18–24 岁爱做美甲的女性"
        />
      </label>
      <label className="field">
        <span>
          用户痛点 <em>可选，不填由 AI 推断</em>
        </span>
        <textarea
          maxLength={150}
          value={input.painPoints ?? ""}
          onChange={(event) => update("painPoints", event.target.value)}
        />
      </label>
      <label className="field">
        <span>
          产品利益点 <em>可选</em>
        </span>
        <textarea
          maxLength={100}
          value={input.benefits ?? ""}
          onChange={(event) => update("benefits", event.target.value)}
        />
      </label>
    </div>
  );
}

function StyleStep({
  input,
  update,
}: {
  input: AdScriptInput;
  update: <K extends keyof AdScriptInput>(key: K, value: AdScriptInput[K]) => void;
}) {
  return (
    <div className="ad-script-section form-section">
      <h2>脚本风格</h2>
      <div className="field">
        <span>演讲角色</span>
        <div className="role-grid">
          {roles.map(([role, description]) => (
            <button
              type="button"
              key={role}
              className={input.speakerRole === role ? "selected" : ""}
              onClick={() => update("speakerRole", role)}
            >
              <Pencil />
              <span>
                <b>{role}</b>
                <small>{description}</small>
              </span>
              <i>{input.speakerRole === role && <Check />}</i>
            </button>
          ))}
        </div>
      </div>
      {input.speakerRole === "自定义角色" && (
        <label className="field">
          <span>
            角色背景 <i>*</i>
          </span>
          <input
            value={input.customRole ?? ""}
            onChange={(event) => update("customRole", event.target.value)}
            placeholder="描述身份、经历和说话特点"
          />
        </label>
      )}
      <div className="field">
        <span>脚本风格</span>
        <div className="pill-group">
          {styles.map((style) => (
            <button
              type="button"
              key={style}
              className={input.scriptStyle === style ? "active" : ""}
              onClick={() => update("scriptStyle", style)}
            >
              {style}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>开场方式</span>
        <select value={input.openingStyle} onChange={(event) => update("openingStyle", event.target.value)}>
          <option>痛点直击</option>
          <option>反常识悬念</option>
          <option>利益先行</option>
          <option>故事切入</option>
          <option>数据冲击</option>
        </select>
      </label>
      <details className="advanced">
        <summary>
          <Pencil /> 高级设置
        </summary>
        <p>当前使用固定模型、四维等权评分、最多 5 轮调优；达到 85 分且合规后提前结束。</p>
      </details>
      <div className="cost-summary">
        <Sparkles />
        <div>
          <b>将生成 {input.batchCount} 条差异化脚本</b>
          <span>每条 20 创作点 · 固定使用 deepseek/deepseek-v4-pro</span>
        </div>
        <strong>{input.batchCount * 20} 点</strong>
      </div>
    </div>
  );
}

function ProgressScreen({
  project,
  error,
  onBack,
  onCancel,
  cancelling,
}: {
  project?: AdScriptProject;
  error: string;
  onBack: () => void;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (project && ["succeeded", "partially_succeeded", "failed", "cancelled"].includes(project.project.status)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [project]);
  const elapsedSeconds = project ? Math.max(0, Math.floor((now - Date.parse(project.project.createdAt)) / 1_000)) : 0;
  const progress = project
    ? Math.round(
        project.variants.reduce(
          (sum, variant) =>
            sum +
            (variant.status === "succeeded" || variant.status === "failed" ? 100 : 15 + variant.iterationCount * 16),
          0,
        ) / project.variants.length,
      )
    : 4;
  return (
    <section className="ad-script-page progress-page">
      <header>
        <LoaderCircle className="spin" />
        <h1>AI 智能调优中</h1>
        <p>已耗时 {elapsedSeconds} 秒 · 目标 1 分钟内完成</p>
      </header>
      <div className="progress-meta">
        <span>{project?.project.status === "queued" ? "等待 Worker" : "生成与调优"}</span>
        <b>{progress}%</b>
      </div>
      <div className="progress-track">
        <i style={{ width: `${progress}%` }} />
      </div>
      <div className="variant-progress-list">
        {project?.variants.map((variant) => (
          <article key={variant.id}>
            <span className={`status-dot ${variant.status}`}>
              {variant.status === "succeeded" ? <Check /> : variant.ordinal}
            </span>
            <div>
              <b>A/B 变体 {variant.ordinal}</b>
              <p>
                {variant.status === "failed"
                  ? variant.error?.message
                  : variant.status === "succeeded"
                    ? `最终得分 ${variant.finalScore} · ${variant.iterationCount} 轮`
                    : `正在执行第 ${Math.max(1, variant.iterationCount + 1)} 轮`}
              </p>
            </div>
            <em>{variant.status === "succeeded" ? "完成" : variant.status === "failed" ? "失败" : "处理中"}</em>
          </article>
        )) ?? (
          <article>
            <LoaderCircle className="spin" />
            <div>
              <b>正在创建任务</b>
              <p>请稍候</p>
            </div>
          </article>
        )}
      </div>
      {error && <p className="ad-script-feedback error">{error}</p>}
      <div className="progress-actions">
        <button type="button" className="secondary" onClick={onBack}>
          <ArrowLeft /> 返回配置
        </button>
        {project && ["queued", "processing"].includes(project.project.status) && (
          <button type="button" className="secondary danger" disabled={cancelling} onClick={onCancel}>
            {cancelling ? <LoaderCircle className="spin" /> : null} 取消整批任务
          </button>
        )}
      </div>
    </section>
  );
}

function ResultScreen({
  project,
  selectedVariant,
  selectedVersionId,
  editor,
  busy,
  actionJob,
  error,
  notice,
  onEditor,
  onVariant,
  onVersion,
  onSave,
  onAction,
  onExport,
  onReset,
  onRegenerate,
}: {
  project: AdScriptProject;
  selectedVariant: AdScriptVariant;
  selectedVersionId: string;
  editor: string;
  busy: string;
  actionJob?: Job;
  error: string;
  notice: string;
  onEditor: (value: string) => void;
  onVariant: (id: string) => void;
  onVersion: (id: string) => void;
  onSave: () => void;
  onAction: (action: "rescore" | "continue") => void;
  onExport: (format: "txt" | "md") => void;
  onReset: () => void;
  onRegenerate: () => void;
}) {
  const version =
    selectedVariant.versions.find((item) => item.id === selectedVersionId) ?? currentVersion(selectedVariant);
  if (!version) return null;
  const scoreRows = [
    ["开场吸引力", version.score.scores.openingAttraction],
    ["痛点共鸣度", version.score.scores.painResonance],
    ["利益点清晰度", version.score.scores.benefitClarity],
    ["行动召唤强度", version.score.scores.callToAction],
  ] as const;
  return (
    <section className="ad-script-page result-page">
      <header className="result-summary">
        <div>
          <MapPin />
          <div>
            <b>{project.project.input.productName}</b>
            <span>
              {scenes[project.project.input.sceneCategory].find(([id]) => id === project.project.input.sceneId)?.[1]}
            </span>
          </div>
        </div>
        <div className="summary-metrics">
          <span>
            <strong>{version.score.total}</strong>转化力评分
          </span>
          <span>
            <strong>{[...version.script.replace(/\s/g, "")].length}</strong>字数
          </span>
          <span>
            <strong>{version.round}</strong>迭代轮次
          </span>
          <span>
            <strong>{version.compliance.passed ? <CheckCircle2 /> : "!"}</strong>合规状态
          </span>
        </div>
        <div className="summary-tags">
          <em className={version.compliance.passed ? "pass" : "warn"}>
            {version.compliance.passed ? "合规" : "需复核"}
          </em>
          <em>AI 深度打磨</em>
        </div>
      </header>
      <div className="variant-tabs">
        {project.variants
          .filter((item) => item.status === "succeeded")
          .map((variant) => (
            <button
              type="button"
              key={variant.id}
              className={variant.id === selectedVariant.id ? "active" : ""}
              onClick={() => onVariant(variant.id)}
            >
              版本 {String.fromCharCode(64 + variant.ordinal)} · {variant.finalScore} 分
            </button>
          ))}
      </div>
      <div className="result-grid">
        <article className="script-editor">
          <header>
            <h2>脚本正文</h2>
            <button type="button" onClick={() => void navigator.clipboard.writeText(editor)}>
              <Copy /> 复制脚本
            </button>
          </header>
          <textarea value={editor} onChange={(event) => onEditor(event.target.value)} />
          <footer>
            <span>编辑后保存为新的人工版本</span>
            <button
              type="button"
              className="primary compact"
              disabled={busy === "save" || editor === version.script}
              onClick={onSave}
            >
              {busy === "save" ? <LoaderCircle className="spin" /> : <Check />} 保存版本
            </button>
          </footer>
        </article>
        <article className="analysis-panel">
          <nav>
            <b>AI 分析</b>
            <span>版本历史</span>
            <select value={version.id} onChange={(event) => onVersion(event.target.value)}>
              {selectedVariant.versions.map((item) => (
                <option value={item.id} key={item.id}>
                  #{item.sequence} ·{" "}
                  {item.source === "human" ? "人工" : item.source === "initial" ? "初稿" : `AI 第 ${item.round} 轮`} ·{" "}
                  {item.score.total}分
                </option>
              ))}
            </select>
          </nav>
          <div className="analysis-scroll">
            <h3>
              转化力评分{" "}
              <strong>
                {version.score.total}
                <small>/100</small>
              </strong>
            </h3>
            {scoreRows.map(([label, value]) => (
              <div className="score-row" key={label}>
                <span>
                  {label}
                  <b>{value * 4}</b>
                </span>
                <i>
                  <em style={{ width: `${value * 4}%` }} />
                </i>
              </div>
            ))}
            <h3>优化建议</h3>
            {version.score.suggestions.map((suggestion) => (
              <p className="suggestion" key={suggestion}>
                <ArrowRight />
                {suggestion}
              </p>
            ))}
            <h3>
              <ShieldCheck /> 合规检测
            </h3>
            {version.compliance.findings.length ? (
              version.compliance.findings.map((finding) => (
                <p
                  className={`finding ${finding.severity}`}
                  key={`${finding.ruleId}:${finding.start ?? finding.excerpt}`}
                >
                  <b>{finding.excerpt || finding.ruleId}</b>
                  {finding.message}
                  <small>{finding.suggestion}</small>
                </p>
              ))
            ) : (
              <p className="compliance-pass">
                <CheckCircle2 /> 未发现阻断级风险
              </p>
            )}
          </div>
        </article>
      </div>
      {actionJob && busy && (
        <p className="action-progress">
          <LoaderCircle className="spin" /> {actionJob.stage} · {actionJob.progress}%
        </p>
      )}
      {(error || notice) && <p className={`ad-script-feedback ${error ? "error" : "success"}`}>{error || notice}</p>}
      <footer className="result-actions">
        <button type="button" onClick={onReset}>
          <RefreshCcw /> 重新设置
        </button>
        <button type="button" onClick={() => onAction("rescore")} disabled={Boolean(busy)}>
          <Target /> 重新评分
        </button>
        <button type="button" onClick={() => onAction("continue")} disabled={Boolean(busy) || version.round >= 5}>
          <Sparkles /> 继续调优
        </button>
        <button type="button" onClick={onRegenerate} disabled={Boolean(busy)}>
          <RefreshCcw /> 重新生成
        </button>
        <button type="button" onClick={() => onExport("txt")}>
          <Download /> TXT
        </button>
        <button type="button" onClick={() => onExport("md")}>
          <Clipboard /> Markdown
        </button>
      </footer>
    </section>
  );
}
