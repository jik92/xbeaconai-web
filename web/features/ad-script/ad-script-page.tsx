import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Copy,
  Download,
  FileSearch,
  FileText,
  History,
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
  fetchAdScriptProjects,
  fetchJob,
  parseExistingAdScript,
  requestCancel,
  runAdScriptAction,
  saveAdScriptHumanVersion,
  watchJob,
} from "@/api/api-client";
import type { AdScriptInput, AdScriptProject, AdScriptVariant, Job } from "@/api/generated/types.gen";
import { ProjectRecordDrawer, type ProjectRecordStatusTone } from "@/components/domain/project-record-drawer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useAuth } from "@/features/account/auth-context";
import { cn } from "@/lib/utils";

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

const sceneCategoryOptions = [
  { value: "marketing", label: "营销场景" },
  { value: "placement", label: "投放场景" },
] as const;

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
const legacyActiveProjectKey = "fenghuo:ad-script:active-project:v1";
const adScriptWorkflowStages = ["选择场景", "广告诉求", "脚本风格", "生成调优", "脚本结果"];

const adScriptStatusLabels: Record<AdScriptProject["project"]["status"], string> = {
  draft: "草稿",
  queued: "等待生成",
  processing: "生成中",
  succeeded: "已完成",
  partially_succeeded: "部分完成",
  failed: "失败",
  cancelled: "已取消",
};

function adScriptStatusTone(status: AdScriptProject["project"]["status"]): ProjectRecordStatusTone {
  if (status === "failed" || status === "cancelled") return "error";
  if (status === "succeeded" || status === "partially_succeeded") return "success";
  if (status === "queued" || status === "processing") return "progress";
  return "neutral";
}

function AdScriptWorkflowHeader({
  stage,
  onHistory,
  onNew,
}: {
  stage: number;
  onHistory: () => void;
  onNew: () => void;
}) {
  return (
    <header className="grid h-14 shrink-0 grid-cols-[132px_minmax(0,1fr)_188px] items-center border-b border-line bg-surface px-3 shadow-sm max-[760px]:grid-cols-[36px_minmax(0,1fr)_80px]">
      <div className="flex items-center gap-2 whitespace-nowrap type-section-title text-ink">
        <FileText className="size-5" />
        <span className="max-[760px]:hidden">口播脚本</span>
      </div>
      <ol className="flex min-w-0 items-center justify-center" aria-label="口播脚本创作进度">
        {adScriptWorkflowStages.map((label, index) => (
          <li
            className={cn(
              "flex min-w-0 items-center gap-1.5 whitespace-nowrap text-muted",
              index === stage ? "type-body-strong text-ink" : "type-helper",
              index < stage && "text-success",
            )}
            key={label}
            aria-label={label}
            aria-current={index === stage ? "step" : undefined}
          >
            <i
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full bg-canvas-soft not-italic type-badge",
                index === stage && "bg-primary text-on-primary",
                index < stage && "bg-surface-strong text-success",
              )}
            >
              {index < stage ? <Check className="size-3" /> : index + 1}
            </i>
            <span className="max-[1100px]:hidden">{label}</span>
            {index < adScriptWorkflowStages.length - 1 && (
              <ChevronRight className="mx-1 size-3 shrink-0 text-muted-soft" />
            )}
          </li>
        ))}
      </ol>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" aria-label="生成记录" onClick={onHistory}>
          <History />
          <span className="max-[760px]:hidden">生成记录</span>
        </Button>
        <Button variant="ghost" size="sm" aria-label="新建口播脚本" onClick={onNew}>
          <Plus />
          <span className="max-[760px]:hidden">新建</span>
        </Button>
      </div>
    </header>
  );
}

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
  const [input, setInput] = useState<AdScriptInput>(loadDraft);
  const [step, setStep] = useState(0);
  const [screen, setScreen] = useState<"form" | "progress" | "result">("form");
  const [projectId, setProjectId] = useState("");
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [editor, setEditor] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
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
    localStorage.removeItem(legacyActiveProjectKey);
  }, []);
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

  const startNewProject = () => {
    setInput(defaultInput);
    setProjectId("");
    setSelectedVariantId("");
    setSelectedVersionId("");
    setEditor("");
    setExtracted(undefined);
    setActionJob(undefined);
    setBusy("");
    setError("");
    setNotice("");
    setScreen("form");
    setStep(0);
    setHistoryOpen(false);
  };
  const workflowStage = screen === "form" ? step : screen === "progress" ? 3 : 4;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-surface type-body text-ink">
      <AdScriptWorkflowHeader stage={workflowStage} onHistory={() => setHistoryOpen(true)} onNew={startNewProject} />
      {screen === "progress" ? (
        <ProgressScreen
          project={project}
          error={error || (projectQuery.error ? messageOf(projectQuery.error) : "")}
          onBack={() => setScreen("form")}
          onCancel={() => void cancelGeneration()}
          cancelling={busy === "cancel"}
        />
      ) : screen === "result" && project && selectedVariant && selectedVersion ? (
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
          onRegenerate={() => void regenerate()}
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-3 sm:p-6">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
            <Card className="ad-script-card gap-0 py-0 shadow-none">
              <CardContent className="p-4 sm:p-6">
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
                {(error || notice) && <Feedback message={error || notice} error={Boolean(error)} />}
              </CardContent>
              <footer className="flex gap-2 border-t border-line p-3 sm:px-6">
                {step > 0 && (
                  <Button variant="outline" className="rounded-full" onClick={() => setStep((value) => value - 1)}>
                    <ArrowLeft /> 上一步
                  </Button>
                )}
                <Button
                  className="ml-auto min-w-36 rounded-full"
                  data-role="ad-script-next"
                  disabled={!validStep || Boolean(busy)}
                  onClick={() => (step < 2 ? setStep((value) => value + 1) : void generate())}
                >
                  {busy === "generate" ? <LoaderCircle className="animate-spin" /> : step === 2 ? <Sparkles /> : null}
                  {step === 2 ? `生成脚本 · ${input.batchCount * 20} 创作点` : "下一步"}
                  <ArrowRight />
                </Button>
              </footer>
            </Card>
          </div>
        </div>
      )}
      <ProjectRecordDrawer
        open={historyOpen}
        queryKey="ad-script-project-records"
        currentProjectId={projectId}
        statusOptions={Object.entries(adScriptStatusLabels).map(([value, label]) => ({ value, label }))}
        onClose={() => setHistoryOpen(false)}
        fetchPage={async ({ query, status, page, pageSize }) => {
          const projects = (await fetchAdScriptProjects())
            .filter((item) => !status || item.project.status === status)
            .filter((item) => {
              const keyword = query?.trim().toLowerCase();
              return !keyword || item.project.input.productName.toLowerCase().includes(keyword);
            })
            .sort((left, right) => right.project.updatedAt.localeCompare(left.project.updatedAt));
          const offset = (page - 1) * pageSize;
          return {
            items: projects.slice(offset, offset + pageSize).map((item) => {
              const scene = scenes[item.project.input.sceneCategory].find(([id]) => id === item.project.input.sceneId);
              return {
                id: item.project.id,
                title: item.project.input.productName || "未命名产品",
                status: item.project.status,
                statusLabel: adScriptStatusLabels[item.project.status],
                statusTone: adScriptStatusTone(item.project.status),
                summary: `${scene?.[1] ?? "未选择场景"} · ${item.project.input.batchCount} 条脚本`,
                updatedAt: item.project.updatedAt,
              };
            }),
            total: projects.length,
            page,
            pageSize,
          };
        }}
        onContinue={async (item) => {
          const selected = await fetchAdScriptProject(item.id);
          setInput(selected.project.input);
          setProjectId(selected.project.id);
          setSelectedVariantId("");
          setSelectedVersionId("");
          setScreen("progress");
          setHistoryOpen(false);
          setError("");
          setNotice("");
        }}
      />
    </section>
  );
}

function Feedback({ message, error }: { message: string; error: boolean }) {
  return (
    <p
      className={cn(
        "ad-script-feedback mt-4 rounded-lg border px-3 py-2 type-helper",
        error ? "border-error/20 bg-error/5 text-error" : "border-success/20 bg-success/5 text-success",
      )}
    >
      {message}
    </p>
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
    <div className="ad-script-section space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="type-section-title">选择{input.sceneCategory === "marketing" ? "营销" : "投放"}场景</h2>
        <SegmentedControl
          ariaLabel="场景类型"
          value={input.sceneCategory}
          options={sceneCategoryOptions}
          onValueChange={(category) => {
            update("sceneCategory", category);
            const next = scenes[category][0];
            update("sceneId", next[0]);
            update("targetLength", next[3]);
          }}
        />
      </div>
      <div className="scene-grid grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {scenes[input.sceneCategory].map(([id, name, description, length]) => (
          <Button
            variant="outline"
            key={id}
            className={cn(
              "h-auto min-h-32 flex-col items-start justify-start gap-2 whitespace-normal rounded-xl p-4 text-left shadow-none",
              input.sceneId === id && "border-primary bg-surface-muted ring-1 ring-primary/15",
            )}
            onClick={() => {
              update("sceneId", id);
              update("targetLength", length);
            }}
          >
            <span className="grid size-8 place-items-center rounded-lg bg-surface-muted text-muted">
              {id === "local-store" ? <MapPin /> : <Target />}
            </span>
            <b className="text-ink">{name}</b>
            <small className="type-helper text-muted">{description}</small>
            <span className="mt-auto rounded-full bg-surface-muted px-2 py-1 type-helper text-muted">{length}字</span>
          </Button>
        ))}
      </div>
      <div className="batch-row flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4">
        <div>
          <b className="">批量生成</b>
          <span className="mt-1 block type-helper text-muted">同时生成多条差异化变体</span>
        </div>
        <div className="counter flex items-center gap-3">
          <Button
            variant="outline"
            size="icon-sm"
            className="size-8 rounded-full"
            aria-label="减少生成数量"
            onClick={() => update("batchCount", Math.max(1, input.batchCount - 1))}
          >
            <Minus />
          </Button>
          <b className="min-w-5 text-center">{input.batchCount}</b>
          <Button
            variant="outline"
            size="icon-sm"
            className="size-8 rounded-full"
            aria-label="增加生成数量"
            onClick={() => update("batchCount", Math.min(3, input.batchCount + 1))}
          >
            <Plus />
          </Button>
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
    <div className="ad-script-section form-section mx-auto max-w-4xl space-y-5">
      <Button
        variant="outline"
        className="source-toggle h-auto w-full justify-start rounded-xl px-4 py-3 text-left"
        onClick={() => setSourceOpen(!sourceOpen)}
      >
        <FileSearch className="text-muted" />
        <b className="">解析现有脚本</b>
        <ChevronDown className={cn("ml-auto transition-transform", sourceOpen && "rotate-180")} />
      </Button>
      {sourceOpen && (
        <div className="source-panel space-y-3 rounded-xl border border-line bg-surface-muted p-4">
          <textarea
            aria-label="现有口播脚本"
            className="min-h-28 w-full resize-y rounded-md border border-line bg-surface px-3 py-2 type-body text-ink outline-none placeholder:text-muted focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
            value={input.sourceScript ?? ""}
            onChange={(event) => update("sourceScript", event.target.value)}
            placeholder="粘贴现有口播脚本或竞品脚本原文…"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button className="rounded-full" size="sm" disabled={busy === "parse"} onClick={onParse}>
              {busy === "parse" ? <LoaderCircle className="animate-spin" /> : <Sparkles />} AI 解析
            </Button>
            <Label className="type-label text-muted">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={input.useSourceAsReference ?? false}
                onChange={(event) => update("useSourceAsReference", event.target.checked)}
              />
              同时作为生成灵感参考
            </Label>
          </div>
        </div>
      )}
      {extracted && (
        <div className="extract-review rounded-xl border border-line bg-surface-muted p-4">
          <b className="">解析结果待确认</b>
          <p className="mt-1 type-helper text-muted">
            {extracted.productName || "未识别产品名"} · {extracted.sellingPoints?.join("、") || "未识别卖点"}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              忽略
            </Button>
            <Button size="sm" className="rounded-full" onClick={onApply}>
              <Check /> 确认填入
            </Button>
          </div>
        </div>
      )}
      <div className="selected-scene flex items-center gap-3 rounded-xl border border-line bg-surface-muted p-3">
        <MapPin className="size-4 text-muted" />
        <div className="min-w-0 flex-1">
          <b className="">{scenes[input.sceneCategory].find(([id]) => id === input.sceneId)?.[1]}</b>
          <span className="mt-0.5 block truncate type-helper text-muted">
            {scenes[input.sceneCategory].find(([id]) => id === input.sceneId)?.[2]}
          </span>
        </div>
        <span className="rounded-full bg-surface px-2 py-1 type-helper text-muted">{input.targetLength}字</span>
      </div>
      <Label className="field block space-y-2">
        <span>
          产品名称 <i className="text-error not-italic">*</i>
        </span>
        <Input
          value={input.productName}
          maxLength={30}
          onChange={(event) => update("productName", event.target.value)}
          placeholder="例如：玻尿酸精华液 / 小米 14 Pro"
        />
        <small className="block text-right type-helper text-muted">{input.productName.length} / 30</small>
      </Label>
      <Label className="field block space-y-2">
        <span className="flex items-center">
          产品卖点 <i className="text-error not-italic">*</i>
          <em className="ml-auto type-helper not-italic text-muted">每行一个，最多 6 条</em>
        </span>
        <textarea
          className="min-h-24 w-full resize-y rounded-md border border-line bg-transparent px-3 py-2 type-body text-ink outline-none placeholder:text-muted focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
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
        <small className="block text-right type-helper text-muted">{input.sellingPoints.length} / 6 条</small>
      </Label>
      <div className="field space-y-2">
        <span className="type-body-strong">文案字数</span>
        <div className="pill-group flex flex-wrap gap-2">
          {lengths.map((length) => (
            <Button
              variant={input.targetLength === length ? "default" : "outline"}
              size="sm"
              key={length}
              className="rounded-full"
              onClick={() => update("targetLength", length)}
            >
              {length}字
            </Button>
          ))}
        </div>
      </div>
      <div className="field space-y-2">
        <span className="type-body-strong">
          营销目标 <i className="text-error not-italic">*</i>
        </span>
        <div className="pill-group flex flex-wrap gap-2">
          {goals.map((goal) => (
            <Button
              variant={input.marketingGoal === goal ? "default" : "outline"}
              size="sm"
              key={goal}
              className="rounded-full"
              onClick={() => update("marketingGoal", goal)}
            >
              {goal}
            </Button>
          ))}
        </div>
      </div>
      <Label className="field block space-y-2">
        <span>
          目标用户 <i className="text-error not-italic">*</i>
        </span>
        <Input
          value={input.targetAudience}
          onChange={(event) => update("targetAudience", event.target.value)}
          placeholder="例如：18–24 岁爱做美甲的女性"
        />
      </Label>
      <Label className="field block space-y-2">
        <span className="flex items-center">
          用户痛点 <em className="ml-auto type-helper not-italic text-muted">可选</em>
        </span>
        <textarea
          className="min-h-20 w-full resize-y rounded-md border border-line bg-transparent px-3 py-2 type-body text-ink outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
          maxLength={150}
          value={input.painPoints ?? ""}
          onChange={(event) => update("painPoints", event.target.value)}
        />
      </Label>
      <Label className="field block space-y-2">
        <span className="flex items-center">
          产品利益点 <em className="ml-auto type-helper not-italic text-muted">可选</em>
        </span>
        <textarea
          className="min-h-20 w-full resize-y rounded-md border border-line bg-transparent px-3 py-2 type-body text-ink outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
          maxLength={100}
          value={input.benefits ?? ""}
          onChange={(event) => update("benefits", event.target.value)}
        />
      </Label>
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
    <div className="ad-script-section form-section mx-auto max-w-4xl space-y-5">
      <h2 className="type-section-title">脚本风格</h2>
      <div className="field space-y-2">
        <span className="type-body-strong">演讲角色</span>
        <div className="role-grid grid grid-cols-1 gap-2 sm:grid-cols-2">
          {roles.map(([role, description]) => (
            <Button
              variant="outline"
              key={role}
              className={cn(
                "h-auto min-h-16 justify-start whitespace-normal rounded-xl p-3 text-left shadow-none",
                input.speakerRole === role && "border-primary bg-surface-muted ring-1 ring-primary/15",
              )}
              onClick={() => update("speakerRole", role)}
            >
              <Pencil className="text-muted" />
              <span className="min-w-0 flex-1">
                <b className="block">{role}</b>
                <small className="mt-0.5 block type-helper text-muted">{description}</small>
              </span>
              {input.speakerRole === role && <Check className="text-primary" />}
            </Button>
          ))}
        </div>
      </div>
      {input.speakerRole === "自定义角色" && (
        <Label className="field block space-y-2">
          <span>
            角色背景 <i className="text-error not-italic">*</i>
          </span>
          <Input
            value={input.customRole ?? ""}
            onChange={(event) => update("customRole", event.target.value)}
            placeholder="描述身份、经历和说话特点"
          />
        </Label>
      )}
      <div className="field space-y-2">
        <span className="type-body-strong">脚本风格</span>
        <div className="pill-group flex flex-wrap gap-2">
          {styles.map((style) => (
            <Button
              variant={input.scriptStyle === style ? "default" : "outline"}
              size="sm"
              key={style}
              className="rounded-full"
              onClick={() => update("scriptStyle", style)}
            >
              {style}
            </Button>
          ))}
        </div>
      </div>
      <Label className="field flex-col items-start gap-2">
        <span>开场方式</span>
        <NativeSelect value={input.openingStyle} onChange={(event) => update("openingStyle", event.target.value)}>
          <option>痛点直击</option>
          <option>反常识悬念</option>
          <option>利益先行</option>
          <option>故事切入</option>
          <option>数据冲击</option>
        </NativeSelect>
      </Label>
      <details className="advanced rounded-xl border border-line px-4">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 type-body-strong">
          <Pencil /> 高级设置
        </summary>
        <p className="pb-4 type-helper text-muted">采用四维等权评分，最多进行 5 轮调优；达到 85 分且合规后提前结束。</p>
      </details>
      <div className="cost-summary flex items-center gap-3 rounded-xl border border-line bg-surface-muted p-4">
        <Sparkles className="text-muted" />
        <div className="min-w-0 flex-1">
          <b className="">将生成 {input.batchCount} 条差异化脚本</b>
          <span className="mt-0.5 block type-helper text-muted">每条消耗 20 创作点</span>
        </div>
        <strong className="">{input.batchCount * 20} 点</strong>
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
  const progress = project?.variants.length
    ? Math.round(
        project.variants.reduce(
          (sum, variant) =>
            sum +
            (variant.status === "succeeded" || variant.status === "failed" ? 100 : 15 + variant.iterationCount * 16),
          0,
        ) / project.variants.length,
      )
    : project
      ? 0
      : 4;
  const projectStatus = project?.project.status;
  const progressTitle =
    projectStatus === "failed" ? "生成失败" : projectStatus === "cancelled" ? "任务已取消" : "AI 智能调优中";
  return (
    <div className="contents">
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
          <div className="flex items-center gap-3 py-2">
            <span className="grid size-10 place-items-center rounded-full bg-surface-muted">
              {projectStatus === "failed" ? (
                <FileSearch className="text-error" />
              ) : projectStatus === "cancelled" ? (
                <Minus className="text-muted" />
              ) : (
                <LoaderCircle className="animate-spin text-muted" />
              )}
            </span>
            <div>
              <h2 className="type-section-title">{progressTitle}</h2>
              <p className="type-helper text-muted">
                {projectStatus === "failed" || projectStatus === "cancelled"
                  ? `任务已结束 · 共耗时 ${elapsedSeconds} 秒`
                  : `已耗时 ${elapsedSeconds} 秒 · 目标 1 分钟内完成`}
              </p>
            </div>
          </div>
          <Card className="gap-0 py-0 shadow-none">
            <CardContent className="space-y-3 p-4 sm:p-6">
              <div className="progress-meta flex items-center justify-between type-helper text-muted">
                <span>{project?.project.status === "queued" ? "等待 Worker" : "生成与调优"}</span>
                <b className="text-ink">{progress}%</b>
              </div>
              <div className="progress-track h-2 overflow-hidden rounded-full bg-surface-muted">
                <i
                  className="block h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="variant-progress-list divide-y divide-line">
                {project?.variants.map((variant) => (
                  <article className="flex min-h-16 items-center gap-3 py-3" key={variant.id}>
                    <span
                      className={cn(
                        "status-dot grid size-8 place-items-center rounded-full bg-surface-muted type-helper",
                        variant.status === "succeeded" && "bg-success text-on-primary",
                        variant.status === "failed" && "bg-error/5 text-error",
                        variant.status === "cancelled" && "text-muted",
                      )}
                    >
                      {variant.status === "succeeded" ? <Check className="size-4" /> : variant.ordinal}
                    </span>
                    <div className="min-w-0 flex-1">
                      <b className="">变体 {variant.ordinal}</b>
                      <p className="truncate type-helper text-muted">
                        {variant.status === "failed"
                          ? variant.error?.message
                          : variant.status === "cancelled"
                            ? "任务已取消"
                            : variant.status === "succeeded"
                              ? `最终得分 ${variant.finalScore} · ${variant.iterationCount} 轮`
                              : `正在执行第 ${Math.max(1, variant.iterationCount + 1)} 轮`}
                      </p>
                    </div>
                    <span className="type-helper text-muted">
                      {variant.status === "succeeded"
                        ? "完成"
                        : variant.status === "failed"
                          ? "失败"
                          : variant.status === "cancelled"
                            ? "已取消"
                            : "处理中"}
                    </span>
                  </article>
                )) ?? (
                  <article className="flex min-h-16 items-center gap-3 py-3">
                    <LoaderCircle className="animate-spin text-muted" />
                    <div>
                      <b className="">正在创建任务</b>
                      <p className="type-helper text-muted">请稍候</p>
                    </div>
                  </article>
                )}
              </div>
            </CardContent>
          </Card>
          {error && <Feedback message={error} error />}
          <div className="progress-actions flex flex-wrap justify-between gap-2">
            <Button variant="outline" className="rounded-full" onClick={onBack}>
              <ArrowLeft /> 返回配置
            </Button>
            {project && ["queued", "processing"].includes(project.project.status) && (
              <Button variant="outline" className="rounded-full text-error" disabled={cancelling} onClick={onCancel}>
                {cancelling ? <LoaderCircle className="animate-spin" /> : null} 取消整批任务
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
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
    <div className="contents">
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <Card className="result-summary gap-0 py-0 shadow-none">
            <CardContent className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(72px,0.6fr))] sm:items-center">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-muted">
                  <MapPin className="size-4 text-muted" />
                </span>
                <div className="min-w-0">
                  <b className="block truncate">{project.project.input.productName}</b>
                  <span className="type-helper text-muted">
                    {
                      scenes[project.project.input.sceneCategory].find(
                        ([id]) => id === project.project.input.sceneId,
                      )?.[1]
                    }
                  </span>
                </div>
              </div>
              {[
                [version.score.total, "转化力评分"],
                [[...version.script.replace(/\s/g, "")].length, "字数"],
                [version.round, "迭代轮次"],
                [version.compliance.passed ? "通过" : "复核", "合规状态"],
              ].map(([value, label]) => (
                <span className="border-l border-line pl-4" key={label}>
                  <strong className="block type-section-title">{value}</strong>
                  <small className="type-helper text-muted">{label}</small>
                </span>
              ))}
            </CardContent>
          </Card>
          <div className="variant-tabs flex flex-wrap gap-2">
            {project.variants
              .filter((item) => item.status === "succeeded")
              .map((variant) => (
                <Button
                  variant={variant.id === selectedVariant.id ? "default" : "outline"}
                  size="sm"
                  className="rounded-full"
                  key={variant.id}
                  onClick={() => onVariant(variant.id)}
                >
                  版本 {String.fromCharCode(64 + variant.ordinal)} · {variant.finalScore} 分
                </Button>
              ))}
          </div>
          <div className="result-grid grid min-h-[560px] grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="script-editor min-h-0 gap-0 overflow-hidden py-0 shadow-none">
              <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
                <h2 className="type-section-title">脚本正文</h2>
                <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(editor)}>
                  <Copy /> 复制脚本
                </Button>
              </header>
              <textarea
                aria-label="脚本正文"
                className="min-h-96 flex-1 resize-none bg-surface p-4 type-section-title leading-loose text-ink outline-none"
                value={editor}
                onChange={(event) => onEditor(event.target.value)}
              />
              <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line p-3 type-helper text-muted">
                <span>编辑后保存为新的人工版本</span>
                <Button
                  size="sm"
                  className="rounded-full"
                  disabled={busy === "save" || editor === version.script}
                  onClick={onSave}
                >
                  {busy === "save" ? <LoaderCircle className="animate-spin" /> : <Check />} 保存版本
                </Button>
              </footer>
            </Card>
            <Card className="analysis-panel min-h-0 gap-0 overflow-hidden py-0 shadow-none">
              <header className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
                <h2 className="type-section-title">分析与合规</h2>
                <NativeSelect value={version.id} onChange={(event) => onVersion(event.target.value)}>
                  {selectedVariant.versions.map((item) => (
                    <option value={item.id} key={item.id}>
                      #{item.sequence} ·{" "}
                      {item.source === "human" ? "人工" : item.source === "initial" ? "初稿" : `第 ${item.round} 轮`} ·{" "}
                      {item.score.total}分
                    </option>
                  ))}
                </NativeSelect>
              </header>
              <div className="analysis-scroll flex-1 space-y-5 overflow-y-auto p-4">
                <section className="space-y-3">
                  <div className="flex items-end justify-between">
                    <h3 className="type-section-title">转化力评分</h3>
                    <strong className="type-body-strong">
                      {version.score.total}
                      <small className="type-helper text-muted">/100</small>
                    </strong>
                  </div>
                  {scoreRows.map(([label, value]) => (
                    <div className="score-row space-y-1" key={label}>
                      <span className="flex justify-between type-helper text-muted">
                        {label}
                        <b className="text-ink">{value * 4}</b>
                      </span>
                      <span className="block h-1.5 overflow-hidden rounded-full bg-surface-muted">
                        <i className="block h-full rounded-full bg-primary" style={{ width: `${value * 4}%` }} />
                      </span>
                    </div>
                  ))}
                </section>
                <section className="space-y-2">
                  <h3 className="type-section-title">优化建议</h3>
                  {version.score.suggestions.map((suggestion) => (
                    <p
                      className="suggestion flex gap-2 rounded-lg bg-surface-muted p-3 type-helper leading-relaxed text-muted"
                      key={suggestion}
                    >
                      <ArrowRight className="mt-0.5 size-3 shrink-0" /> {suggestion}
                    </p>
                  ))}
                </section>
                <section className="space-y-2">
                  <h3 className="flex items-center gap-2 type-section-title">
                    <ShieldCheck /> 合规检测
                  </h3>
                  {version.compliance.findings.length ? (
                    version.compliance.findings.map((finding) => (
                      <p
                        className={cn(
                          "finding rounded-lg border border-line bg-surface-muted p-3 type-helper leading-relaxed text-muted",
                          finding.severity === "blocking" && "border-l-4 border-l-warning",
                        )}
                        key={`${finding.ruleId}:${finding.start ?? finding.excerpt}`}
                      >
                        <b className="block text-ink">{finding.excerpt || finding.ruleId}</b>
                        {finding.message}
                        <small className="mt-1 block type-helper text-muted">{finding.suggestion}</small>
                      </p>
                    ))
                  ) : (
                    <p className="compliance-pass flex items-center gap-2 text-success">
                      <CheckCircle2 /> 未发现阻断级风险
                    </p>
                  )}
                </section>
              </div>
            </Card>
          </div>
          {actionJob && busy && (
            <p className="action-progress flex items-center gap-2 type-helper text-muted">
              <LoaderCircle className="animate-spin" /> {actionJob.stage} · {actionJob.progress}%
            </p>
          )}
          {(error || notice) && <Feedback message={error || notice} error={Boolean(error)} />}
          <footer className="result-actions sticky bottom-3 flex flex-wrap gap-2 rounded-xl border border-line bg-surface/95 p-2 shadow-sm backdrop-blur">
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => onAction("rescore")}
              disabled={Boolean(busy)}
            >
              <Target /> 重新评分
            </Button>
            <Button
              size="sm"
              className="rounded-full"
              onClick={() => onAction("continue")}
              disabled={Boolean(busy) || version.round >= 5}
            >
              <Sparkles /> 继续调优
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={onRegenerate}
              disabled={Boolean(busy)}
            >
              <RefreshCcw /> 重新生成
            </Button>
            <span className="hidden flex-1 sm:block" />
            <Button variant="ghost" size="sm" onClick={() => onExport("txt")}>
              <Download /> TXT
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onExport("md")}>
              <Clipboard /> Markdown
            </Button>
          </footer>
        </div>
      </div>
    </div>
  );
}
