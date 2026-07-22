import { Check, ChevronDown, CircleCheck, FileVideo2, LoaderCircle, Mic2, Pencil } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchJob, runRemixPromptTool } from "@/api/api-client";
import type { Job } from "@/api/generated/types.gen";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  defaultRemixPromptToolConfig,
  type RemixCheckType,
  type RemixPromptTool,
  type RemixPromptToolConfig,
  type RemixRepairRule,
  remixModifyPresets,
  remixPromptToolLabels,
} from "../../../shared/video-remix/prompt-tools";

const toolTitles: Record<RemixPromptTool, string> = {
  check: "脚本智能检查",
  modify: "脚本智能修改",
  voice: "智能更换口播",
};

const checkTypeLabels: Record<RemixCheckType, string> = {
  "action-direction": "动作方向",
  "background-scene": "背景场景",
  "environment-light": "环境光线",
  "character-traits": "人物特征",
  "product-props": "产品道具",
  "platform-policy": "平台规范",
};

const repairRuleLabels: Record<RemixRepairRule, string> = {
  "preserve-at": "保留@符号",
  "product-action-only": "仅改产品动作",
  "preserve-voiceover": "保持口播不变",
};

function copyDefaultConfig(): RemixPromptToolConfig {
  return {
    ...defaultRemixPromptToolConfig,
    checkTypes: [...defaultRemixPromptToolConfig.checkTypes],
    repairRules: [...defaultRemixPromptToolConfig.repairRules],
  };
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "error" in error) {
    const nested = (error as { error?: { message?: string } }).error;
    if (nested?.message) return nested.message;
  }
  return "提示词工具任务提交失败";
}

function Choice({
  checked,
  label,
  type = "checkbox",
  onChange,
}: {
  checked: boolean;
  label: string;
  type?: "checkbox" | "radio";
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
      <input className="size-4 accent-primary" type={type} checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

function VideoSelection({ fileName }: { fileName: string }) {
  return (
    <div className="rounded-xl border border-line bg-white">
      <div className="flex h-12 items-center justify-between border-b border-line px-3">
        <b className="font-medium">视频列表</b>
        <span className="flex items-center gap-2 text-sm text-muted">
          <Check className="size-4 rounded bg-primary p-0.5 text-white" /> 全选　已选 1 条
        </span>
      </div>
      <div className="m-3 flex items-center gap-3 rounded-lg border border-primary bg-surface-muted p-3">
        <Check className="size-5 rounded bg-primary p-0.5 text-white" />
        <FileVideo2 className="size-5 text-muted" />
        <span className="min-w-0">
          <b className="block truncate font-medium">{fileName}</b>
          <small className="text-muted">v1 · AI解析</small>
        </span>
      </div>
    </div>
  );
}

function RadioRows({
  config,
  setConfig,
}: {
  config: RemixPromptToolConfig;
  setConfig: (value: RemixPromptToolConfig) => void;
}) {
  return (
    <>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm text-muted">修改范围</legend>
        <div className="flex gap-5">
          <Choice
            type="radio"
            checked={config.scope === "cross-script"}
            label="跨脚本(保持一致性)"
            onChange={() => setConfig({ ...config, scope: "cross-script" })}
          />
          <Choice
            type="radio"
            checked={config.scope === "single-script"}
            label="单脚本(各自独立)"
            onChange={() => setConfig({ ...config, scope: "single-script" })}
          />
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm text-muted">参考模式</legend>
        <div className="flex gap-5">
          <Choice
            type="radio"
            checked={config.referenceMode === "anchor"}
            label="锚定参考"
            onChange={() => setConfig({ ...config, referenceMode: "anchor" })}
          />
          <Choice
            type="radio"
            checked={config.referenceMode === "chain"}
            label="链式参考"
            onChange={() => setConfig({ ...config, referenceMode: "chain" })}
          />
        </div>
      </fieldset>
    </>
  );
}

function CheckControls({
  config,
  setConfig,
}: {
  config: RemixPromptToolConfig;
  setConfig: (value: RemixPromptToolConfig) => void;
}) {
  const toggleCheck = (item: RemixCheckType) =>
    setConfig({
      ...config,
      checkTypes: config.checkTypes.includes(item)
        ? config.checkTypes.filter((current) => current !== item)
        : [...config.checkTypes, item],
    });
  const toggleRule = (item: RemixRepairRule) =>
    setConfig({
      ...config,
      repairRules: config.repairRules.includes(item)
        ? config.repairRules.filter((current) => current !== item)
        : [...config.repairRules, item],
    });
  return (
    <>
      <RadioRows config={config} setConfig={setConfig} />
      <fieldset>
        <legend className="mb-2 text-sm text-muted">检查类型</legend>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(checkTypeLabels) as RemixCheckType[]).map((item) => (
            <Choice
              key={item}
              checked={config.checkTypes.includes(item)}
              label={checkTypeLabels[item]}
              onChange={() => toggleCheck(item)}
            />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm text-muted">修复规则</legend>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(repairRuleLabels) as RemixRepairRule[]).map((item) => (
            <Choice
              key={item}
              checked={config.repairRules.includes(item)}
              label={repairRuleLabels[item]}
              onChange={() => toggleRule(item)}
            />
          ))}
        </div>
      </fieldset>
      <textarea
        className="min-h-20 w-full resize-y rounded-lg border border-line bg-white p-3 text-sm outline-none focus:border-primary"
        value={config.customInstruction}
        onChange={(event) => setConfig({ ...config, customInstruction: event.target.value })}
        placeholder="自定义检查要求…"
        maxLength={2_000}
      />
    </>
  );
}

function ModifyControls({
  config,
  setConfig,
}: {
  config: RemixPromptToolConfig;
  setConfig: (value: RemixPromptToolConfig) => void;
}) {
  const [presetOpen, setPresetOpen] = useState(false);
  const preset = remixModifyPresets.find((item) => item.id === config.preset);
  return (
    <>
      <label className="space-y-2">
        <span className="block text-sm text-muted">预设场景</span>
        <button
          type="button"
          className="flex h-10 w-full items-center justify-between rounded-lg border border-line bg-white px-3 text-left text-sm outline-none focus:border-primary"
          onClick={() => setPresetOpen((value) => !value)}
        >
          <span className={preset ? "text-ink" : "text-muted"}>{preset?.title ?? "单选，与自定义指令叠加生效"}</span>
          <ChevronDown className="size-4 text-muted" />
        </button>
        {presetOpen && (
          <div className="max-h-72 overflow-auto rounded-xl border border-line bg-white p-1 shadow-lg">
            {remixModifyPresets.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`block w-full rounded-lg p-3 text-left hover:bg-surface-muted ${config.preset === item.id ? "bg-surface-muted" : ""}`}
                onClick={() => {
                  setConfig({ ...config, preset: item.id });
                  setPresetOpen(false);
                }}
              >
                <b className="block font-medium text-ink">{item.title}</b>
                <small className="mt-1 block text-sm leading-5 text-muted">{item.description}</small>
              </button>
            ))}
          </div>
        )}
      </label>
      <label className="space-y-2">
        <span className="block text-sm text-muted">自定义</span>
        <textarea
          className="min-h-24 w-full resize-y rounded-lg border border-line bg-white p-3 text-sm outline-none focus:border-primary"
          value={config.customInstruction}
          onChange={(event) => setConfig({ ...config, customInstruction: event.target.value })}
          placeholder="例：把产品名称改为“星辰”，色调改为暖金，模特改为短发女性"
          maxLength={2_000}
        />
      </label>
      <RadioRows config={config} setConfig={setConfig} />
    </>
  );
}

function VoiceControls({
  config,
  setConfig,
}: {
  config: RemixPromptToolConfig;
  setConfig: (value: RemixPromptToolConfig) => void;
}) {
  return (
    <>
      <div className="flex border-b border-line">
        <button
          type="button"
          className={`h-10 border-b-2 px-3 text-sm ${config.voiceMode === "correct" ? "border-primary text-primary" : "border-transparent text-ink"}`}
          onClick={() => setConfig({ ...config, voiceMode: "correct" })}
        >
          修正口播
        </button>
        <button
          type="button"
          className={`h-10 border-b-2 px-3 text-sm ${config.voiceMode === "replace" ? "border-primary text-primary" : "border-transparent text-ink"}`}
          onClick={() => setConfig({ ...config, voiceMode: "replace" })}
        >
          换口播
        </button>
      </div>
      <p className="text-sm leading-6 text-muted">
        {config.voiceMode === "correct"
          ? "针对字幕缺失、有误或画面口播文案解析偏差的问题，自动识别分镜口播内容，结合分镜时长，精准修正并替换提示词内错误口播文案。"
          : "保持商品事实、镜头顺序和分镜时长不变，按新的表达要求重写每个分镜的口播文案，并同步调整说话神态与音色语气设定。"}
      </p>
      {config.voiceMode === "replace" && (
        <textarea
          className="min-h-28 w-full resize-y rounded-lg border border-line bg-white p-3 text-sm outline-none focus:border-primary"
          value={config.customInstruction}
          onChange={(event) => setConfig({ ...config, customInstruction: event.target.value })}
          placeholder="输入新口播的表达方向、目标人群、语气或必须保留的卖点…"
          maxLength={2_000}
        />
      )}
    </>
  );
}

export function PromptToolModal({
  tool,
  sourceJobId,
  prompt,
  fileName,
  onClose,
  onApply,
}: {
  tool: RemixPromptTool | null;
  sourceJobId?: string;
  prompt: string;
  fileName: string;
  onClose: () => void;
  onApply: (tool: RemixPromptTool, prompt: string, summary: string, findings: string[]) => void;
}) {
  const [config, setConfig] = useState(copyDefaultConfig);
  const [job, setJob] = useState<Job | null>(null);
  const [preview, setPreview] = useState(prompt);
  const [error, setError] = useState("");
  const completedJobs = useRef(new Set<string>());
  const lastOpenedTool = useRef<RemixPromptTool | null>(null);
  const activeJobId = job && (job.status === "queued" || job.status === "processing") ? job.id : undefined;

  useEffect(() => {
    if (!tool || lastOpenedTool.current === tool) return;
    lastOpenedTool.current = tool;
    setConfig(copyDefaultConfig());
    setPreview(prompt);
    setError("");
    setJob((current) => (current && current.status !== "queued" && current.status !== "processing" ? null : current));
  }, [prompt, tool]);

  useEffect(() => {
    if (!activeJobId) return;
    const refresh = () => {
      void fetchJob(activeJobId)
        .then((updated) => {
          setJob(updated);
          if (updated.status === "failed") {
            setError(updated.error?.message ?? "提示词改写失败");
            return;
          }
          const rewritten = updated.values.rewrittenPrompt;
          if (updated.status === "succeeded" && rewritten && !completedJobs.current.has(updated.id)) {
            completedJobs.current.add(updated.id);
            const currentTool = updated.values.promptTool as RemixPromptTool;
            let findings: string[] = [];
            try {
              const parsedFindings = JSON.parse(updated.values.rewriteFindings || "[]");
              if (Array.isArray(parsedFindings))
                findings = parsedFindings.filter((item): item is string => typeof item === "string");
            } catch {
              findings = [];
            }
            setPreview(rewritten);
            onApply(
              currentTool,
              rewritten,
              updated.values.rewriteSummary || updated.result?.summary || "AI 修改完成",
              findings,
            );
          }
        })
        .catch((reason) => setError(errorMessage(reason)));
    };
    refresh();
    const timer = window.setInterval(refresh, 2_000);
    return () => window.clearInterval(timer);
  }, [activeJobId, onApply]);

  const canSubmit = useMemo(() => {
    if (!tool || !sourceJobId || !prompt.trim() || activeJobId) return false;
    if (tool === "check") return config.checkTypes.length > 0;
    if (tool === "modify") return Boolean(config.preset || config.customInstruction.trim());
    return config.voiceMode === "correct" || Boolean(config.customInstruction.trim());
  }, [activeJobId, config, prompt, sourceJobId, tool]);

  const submit = async () => {
    if (!tool || !sourceJobId || !canSubmit) return;
    setError("");
    try {
      setJob(await runRemixPromptTool({ sourceJobId, prompt: preview, tool, config }));
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const reset = () => {
    setConfig(copyDefaultConfig());
    setError("");
  };
  const close = () => {
    lastOpenedTool.current = null;
    if (!activeJobId) setJob(null);
    onClose();
  };

  return (
    <Dialog open={Boolean(tool)} onOpenChange={(open) => !open && close()}>
      <DialogContent className="h-[calc(100vh-24px)] max-w-[calc(100vw-24px)] grid-rows-[56px_minmax(0,1fr)] gap-0 overflow-hidden rounded-xl p-0">
        <header className="flex h-14 flex-none items-center border-b border-line px-4">
          <DialogTitle className="text-lg">{tool ? toolTitles[tool] : "提示词工具"}</DialogTitle>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-r border-line bg-surface-muted/40">
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
              <VideoSelection fileName={fileName} />
              <div className="flex items-center gap-2 border-y border-line py-3 text-primary">
                {tool === "check" ? <CircleCheck /> : tool === "modify" ? <Pencil /> : <Mic2 />}
                <b className="font-medium">{tool ? remixPromptToolLabels[tool] : "提示词工具"}</b>
              </div>
              {tool === "check" && <CheckControls config={config} setConfig={setConfig} />}
              {tool === "modify" && <ModifyControls config={config} setConfig={setConfig} />}
              {tool === "voice" && <VoiceControls config={config} setConfig={setConfig} />}
              {(job || error) && (
                <div className="space-y-2 rounded-lg border border-line bg-white p-3 text-sm">
                  {job && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2">
                        {activeJobId && <LoaderCircle className="size-4 animate-spin" />}
                        {job.stage}
                      </span>
                      <b className="font-medium">{job.progress}%</b>
                    </div>
                  )}
                  {error && <p className="text-danger">{error}</p>}
                </div>
              )}
            </div>
            <footer className="flex flex-none gap-2 border-t border-line bg-white p-4">
              <Button variant="outline" onClick={reset} disabled={Boolean(activeJobId)}>
                重置
              </Button>
              <Button onClick={() => void submit()} disabled={!canSubmit}>
                {activeJobId ? <LoaderCircle className="animate-spin" /> : null}
                {activeJobId ? "处理中" : tool === "voice" && config.voiceMode === "correct" ? "修正" : "开始"}
              </Button>
            </footer>
          </aside>
          <section className="min-h-0 bg-white p-4">
            <pre className="h-full overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-surface-muted/20 p-4 font-sans text-sm leading-6 text-ink">
              {preview}
            </pre>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
