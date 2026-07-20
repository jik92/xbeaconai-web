import { checkAdScriptCompliance } from "../../server/ad-script/compliance";
import {
  AdScriptModelError,
  assertAdScriptModelAvailable,
  evaluateScript,
  extractSourceScript,
  generateScoredInitialScript,
  optimizeScoredScript,
} from "../../server/ad-script/model";
import {
  AD_SCRIPT_MODEL,
  AD_SCRIPT_OPERATION_BUDGET_MS,
  type AdScriptCompliance,
  AdScriptInputSchema,
  nextAdScriptOptimizationRound,
} from "../../server/ad-script/types";
import type { JobRecord, StageProvenance } from "../../server/types";
import type { WorkerJobHandler } from "./types";

function apiError(error: unknown) {
  if (error instanceof AdScriptModelError)
    return { code: error.code, message: error.message, retryable: error.retryable, requestId: crypto.randomUUID() };
  return {
    code: "AD_SCRIPT_PROCESSING_FAILED",
    message: error instanceof Error ? error.message : "口播脚本生成失败",
    retryable: true,
    requestId: crypto.randomUUID(),
  };
}

function mergedCompliance(local: AdScriptCompliance, ai: AdScriptCompliance): AdScriptCompliance {
  const findings = [...local.findings, ...ai.findings];
  return { passed: !findings.some((finding) => finding.severity === "blocking"), findings };
}

function stage(jobId: string, capability: string): StageProvenance {
  return {
    id: `${jobId}:${capability}:${crypto.randomUUID()}`,
    capability,
    executionMode: "real",
    implementation: "aihubmix-text",
    provider: "aihubmix",
    model: AD_SCRIPT_MODEL,
    startedAt: new Date().toISOString(),
  };
}

function adScriptLog(
  event: "start" | "complete" | "error",
  fields: Record<string, boolean | number | string | undefined>,
) {
  console.info(
    `[ad-script] ${JSON.stringify({ timestamp: new Date().toISOString(), event, model: AD_SCRIPT_MODEL, ...fields })}`,
  );
}

async function measured<T>(fields: Record<string, boolean | number | string | undefined>, operation: () => Promise<T>) {
  const startedAt = Date.now();
  adScriptLog("start", fields);
  try {
    const result = await operation();
    adScriptLog("complete", { ...fields, durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    adScriptLog("error", {
      ...fields,
      durationMs: Date.now() - startedAt,
      errorCode: error instanceof AdScriptModelError ? error.code : "AD_SCRIPT_PROCESSING_FAILED",
    });
    throw error;
  }
}

async function executeParse(job: JobRecord, context: Parameters<WorkerJobHandler["execute"]>[1]) {
  const sourceScript = job.values.sourceScript?.trim();
  if (!sourceScript) throw new Error("待解析脚本不能为空");
  context.change(job.id, {
    status: "processing",
    progress: 20,
    stage: "解析已有脚本",
    overallExecutionMode: "real",
  });
  const deadlineAt = Date.now() + AD_SCRIPT_OPERATION_BUDGET_MS;
  const extracted = await measured({ jobId: job.id, stage: "extract" }, () =>
    extractSourceScript(sourceScript, deadlineAt),
  );
  const completedStage = { ...stage(job.id, "ad-script-extract"), completedAt: new Date().toISOString() };
  context.change(job.id, {
    status: "succeeded",
    progress: 100,
    stage: "解析完成",
    overallExecutionMode: "real",
    provenance: [completedStage],
    result: {
      kind: "ad-script-extract",
      title: "已有脚本解析结果",
      summary: "已提取产品信息，请确认后填入。",
      artifacts: [
        {
          id: crypto.randomUUID(),
          name: "ad-script-extracted.json",
          mimeType: "application/json",
          text: JSON.stringify(extracted),
          executionMode: "real",
          lineage: [completedStage],
        },
      ],
      data: { values: job.values, generatedAt: new Date().toISOString(), mock: false },
    },
  });
}

async function executeAction(job: JobRecord, context: Parameters<WorkerJobHandler["execute"]>[1]) {
  const projectStore = context.adScripts;
  if (!projectStore) throw new Error("AD_SCRIPT_STORE_NOT_CONFIGURED");
  const aggregate = projectStore.getOwned(job.values.projectId, job.ownerUserId);
  const variant = aggregate?.variants.find((item) => item.id === job.values.variantId);
  const selectedVersion = variant?.versions.find((version) => version.id === job.values.versionId);
  if (!aggregate || !variant || !selectedVersion) throw new Error("AD_SCRIPT_VERSION_NOT_FOUND");
  let current = selectedVersion;
  context.change(job.id, {
    status: "processing",
    progress: 15,
    stage: job.values.operation === "rescore" ? "重新评分" : "继续调优",
    overallExecutionMode: "real",
  });
  const deadlineAt = Date.now() + AD_SCRIPT_OPERATION_BUDGET_MS;
  const provenance: StageProvenance[] = [];
  if (job.values.operation === "rescore") {
    const scoreStage = stage(job.id, "ad-script-rescore");
    const evaluated = await measured({ jobId: job.id, variant: variant.ordinal, stage: "rescore" }, () =>
      evaluateScript(current.script, aggregate.project.input, deadlineAt),
    );
    const compliance = mergedCompliance(
      checkAdScriptCompliance(current.script, aggregate.project.input),
      evaluated.aiCompliance,
    );
    scoreStage.completedAt = new Date().toISOString();
    provenance.push(scoreStage);
    current = projectStore.appendVersion({
      variantId: variant.id,
      source: "optimized",
      parentVersionId: current.id,
      round: current.round,
      script: current.script,
      score: evaluated.score,
      compliance,
      changeSummary: "根据当前人工版本重新评分",
    });
  } else {
    const round = nextAdScriptOptimizationRound(current.score.total, current.compliance.passed, current.round);
    if (round !== undefined && !context.store.get(job.id)?.cancelRequested) {
      context.change(job.id, {
        progress: 45,
        stage: `继续调优 · 第 ${round} 轮`,
        provenance: [...provenance],
      });
      const optimizeStage = stage(job.id, `ad-script-continue-${round}`);
      const optimized = await measured({ jobId: job.id, variant: variant.ordinal, round, stage: "continue" }, () =>
        optimizeScoredScript(
          {
            script: current.script,
            projectInput: aggregate.project.input,
            score: current.score,
            compliance: current.compliance,
            round,
          },
          deadlineAt,
        ),
      );
      optimizeStage.completedAt = new Date().toISOString();
      provenance.push(optimizeStage);
      const compliance = mergedCompliance(
        checkAdScriptCompliance(optimized.script, aggregate.project.input),
        optimized.aiCompliance,
      );
      current = projectStore.appendVersion({
        variantId: variant.id,
        source: "optimized",
        parentVersionId: current.id,
        round,
        script: optimized.script,
        score: optimized.score,
        compliance,
        changeSummary: optimized.changeSummary,
      });
      adScriptLog("complete", {
        jobId: job.id,
        variant: variant.ordinal,
        round,
        stage: "persisted",
        score: current.score.total,
        compliant: current.compliance.passed,
      });
    }
  }
  projectStore.updateVariant(variant.id, { status: "succeeded" });
  context.change(job.id, {
    status: "succeeded",
    progress: 100,
    stage: job.values.operation === "rescore" ? "评分完成" : "调优完成",
    overallExecutionMode: "real",
    provenance,
    result: {
      kind: "ad-script",
      title: aggregate.project.input.productName,
      summary: job.values.operation === "rescore" ? "已生成新的评分版本" : "已完成继续调优",
      artifacts: [
        {
          id: current.id,
          name: `口播脚本-${variant.ordinal}.txt`,
          mimeType: "text/plain",
          text: current.script,
          executionMode: "real",
          lineage: provenance,
        },
      ],
      data: { values: job.values, generatedAt: new Date().toISOString(), mock: false },
    },
  });
}

export const adScriptJob: WorkerJobHandler = {
  name: "ad-script",
  supports: (job) => job.moduleId === "ad-script",
  async execute(initialJob, context) {
    try {
      if (initialJob.values.operation === "parse-source") {
        await executeParse(initialJob, context);
        return;
      }
      if (["rescore", "continue"].includes(initialJob.values.operation)) {
        await executeAction(initialJob, context);
        return;
      }
      const projectStore = context.adScripts;
      if (!projectStore) throw new Error("AD_SCRIPT_STORE_NOT_CONFIGURED");
      const aggregate = projectStore.getByJobId(initialJob.id);
      if (!aggregate) throw new Error("AD_SCRIPT_PROJECT_NOT_FOUND");
      const projectInput = AdScriptInputSchema.parse(aggregate.project.input);
      projectStore.updateProject(aggregate.project.id, { status: "processing" });
      context.change(initialJob.id, {
        status: "processing",
        progress: Math.max(2, initialJob.progress),
        stage: "准备生成口播脚本",
        overallExecutionMode: "real",
      });

      const deadlineAt = Date.now() + AD_SCRIPT_OPERATION_BUDGET_MS;
      const provenance: StageProvenance[] = [...initialJob.provenance];
      await measured({ jobId: initialJob.id, stage: "model-check" }, () => assertAdScriptModelAvailable(deadlineAt));
      context.change(initialJob.id, {
        stage: `并行生成 ${aggregate.variants.length} 个脚本变体`,
        progress: 8,
      });
      await Promise.allSettled(
        aggregate.variants.map(async (persistedVariant) => {
          const variant = projectStore
            .getByJobId(initialJob.id)
            ?.variants.find((item) => item.id === persistedVariant.id);
          if (!variant || variant.status === "succeeded") return;
          const latestJob = context.store.get(initialJob.id);
          if (!latestJob || latestJob.cancelRequested) {
            projectStore.updateVariant(variant.id, { status: "cancelled" });
            return;
          }
          projectStore.updateVariant(variant.id, { status: "processing", error: null });
          try {
            let current = variant.versions.at(-1);
            if (!current) {
              const generationStage = stage(initialJob.id, `variant-${variant.ordinal}-initial`);
              const generated = await measured(
                { jobId: initialJob.id, variant: variant.ordinal, round: 0, stage: "generate-and-score" },
                () => generateScoredInitialScript(projectInput, variant.ordinal, deadlineAt),
              );
              generationStage.completedAt = new Date().toISOString();
              provenance.push(generationStage);
              const compliance = mergedCompliance(
                checkAdScriptCompliance(generated.script, projectInput),
                generated.aiCompliance,
              );
              current = projectStore.appendVersion({
                variantId: variant.id,
                source: "initial",
                round: 0,
                script: generated.script,
                score: generated.score,
                compliance,
                changeSummary: "生成并完成初次评分",
              });
              adScriptLog("complete", {
                jobId: initialJob.id,
                variant: variant.ordinal,
                round: 0,
                stage: "persisted",
                score: current.score.total,
                compliant: current.compliance.passed,
              });
            }

            if (!current) throw new Error("AD_SCRIPT_VERSION_NOT_PERSISTED");

            const versionToOptimize = current;
            const round = nextAdScriptOptimizationRound(
              versionToOptimize.score.total,
              versionToOptimize.compliance.passed,
              versionToOptimize.round,
            );
            if (round === 1 && !context.store.get(initialJob.id)?.cancelRequested) {
              const optimizeStage = stage(initialJob.id, `variant-${variant.ordinal}-optimize-${round}`);
              const optimized = await measured(
                { jobId: initialJob.id, variant: variant.ordinal, round, stage: "optimize-and-score" },
                () =>
                  optimizeScoredScript(
                    {
                      script: versionToOptimize.script,
                      projectInput,
                      score: versionToOptimize.score,
                      compliance: versionToOptimize.compliance,
                      round,
                    },
                    deadlineAt,
                  ),
              );
              optimizeStage.completedAt = new Date().toISOString();
              provenance.push(optimizeStage);
              const compliance = mergedCompliance(
                checkAdScriptCompliance(optimized.script, projectInput),
                optimized.aiCompliance,
              );
              current = projectStore.appendVersion({
                variantId: variant.id,
                source: "optimized",
                parentVersionId: versionToOptimize.id,
                round,
                script: optimized.script,
                score: optimized.score,
                compliance,
                changeSummary: optimized.changeSummary,
              });
              adScriptLog("complete", {
                jobId: initialJob.id,
                variant: variant.ordinal,
                round,
                stage: "persisted",
                score: current.score.total,
                compliant: current.compliance.passed,
              });
            }
            projectStore.updateVariant(variant.id, { status: "succeeded" });
          } catch (error) {
            projectStore.updateVariant(variant.id, { status: "failed", error: apiError(error) });
          }
        }),
      );

      const finalAggregate = projectStore.getByJobId(initialJob.id);
      if (!finalAggregate) throw new Error("AD_SCRIPT_PROJECT_NOT_FOUND");
      const succeeded = finalAggregate.variants.filter((variant) => variant.status === "succeeded");
      const failed = finalAggregate.variants.filter((variant) => variant.status === "failed");
      const cancelled = finalAggregate.variants.filter((variant) => variant.status === "cancelled");
      const jobCancelled = context.store.get(initialJob.id)?.cancelRequested;
      const projectStatus = jobCancelled
        ? "cancelled"
        : succeeded.length === finalAggregate.variants.length
          ? "succeeded"
          : succeeded.length
            ? "partially_succeeded"
            : "failed";
      projectStore.updateProject(finalAggregate.project.id, { status: projectStatus });
      const status = projectStatus === "partially_succeeded" ? "partially_succeeded" : projectStatus;
      const artifacts = succeeded.flatMap((variant) => {
        const current = variant.versions.find((version) => version.id === variant.currentVersionId);
        return current
          ? [
              {
                id: current.id,
                name: `口播脚本-${variant.ordinal}.txt`,
                mimeType: "text/plain",
                text: current.script,
                executionMode: "real" as const,
                lineage: provenance,
              },
            ]
          : [];
      });
      const terminalError =
        projectStatus === "failed"
          ? {
              code: "BATCH_FAILED_REFUNDED",
              message: "整批口播脚本生成失败，创作点已退还",
              retryable: true,
              requestId: crypto.randomUUID(),
            }
          : undefined;
      if (projectStatus === "failed") projectStore.refundFullyFailed(initialJob.id);
      context.change(initialJob.id, {
        status,
        progress: projectStatus === "cancelled" ? (context.store.get(initialJob.id)?.progress ?? 0) : 100,
        stage:
          projectStatus === "succeeded"
            ? "全部脚本已完成"
            : projectStatus === "partially_succeeded"
              ? "部分脚本生成失败"
              : projectStatus === "cancelled"
                ? "已取消"
                : "整批失败，已退款",
        overallExecutionMode: "real",
        provenance,
        error: terminalError,
        result:
          artifacts.length > 0
            ? {
                kind: "ad-script",
                title: finalAggregate.project.input.productName,
                summary: `成功 ${succeeded.length} 条，失败 ${failed.length} 条，取消 ${cancelled.length} 条`,
                artifacts,
                data: { values: initialJob.values, generatedAt: new Date().toISOString(), mock: false },
              }
            : undefined,
      });
      if (succeeded.length && context.accounts?.taskNotificationsEnabled(initialJob.ownerUserId))
        context.accounts.createNotification(
          initialJob.ownerUserId,
          "task_completed",
          "口播脚本已生成",
          `${initialJob.title} 已生成 ${succeeded.length} 条脚本。`,
          initialJob.id,
        );
    } catch (error) {
      const projectStore = context.adScripts;
      const aggregate = projectStore?.getByJobId(initialJob.id);
      if (aggregate) {
        projectStore?.updateProject(aggregate.project.id, { status: "failed" });
        for (const variant of aggregate.variants)
          if (variant.status !== "succeeded")
            projectStore?.updateVariant(variant.id, { status: "failed", error: apiError(error) });
        projectStore?.refundFullyFailed(initialJob.id);
      }
      context.change(initialJob.id, {
        status: "failed",
        stage: aggregate ? "整批失败，已退款" : "口播脚本任务失败",
        overallExecutionMode: "real",
        error: aggregate
          ? {
              code: "BATCH_FAILED_REFUNDED",
              message: "整批口播脚本生成失败，创作点已退还",
              retryable: true,
              requestId: crypto.randomUUID(),
            }
          : apiError(error),
      });
    }
  },
};
