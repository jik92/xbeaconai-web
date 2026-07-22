import type { JobResult, StageProvenance } from "../../server/types";
import {
  rewriteVideoRemixPrompt,
  VIDEO_REMIX_PROMPT_MODEL,
  VideoRemixPromptModelError,
} from "../../server/video-remix/prompt-rewrite";
import type { RemixPromptTool, RemixPromptToolConfig } from "../../shared/video-remix/prompt-tools";
import type { WorkerJobHandler } from "./types";

export const videoRemixPromptRewriteJob: WorkerJobHandler = {
  name: "video-remix-prompt-rewrite",
  supports: (job) => job.moduleId === "video-remix" && job.values.workflowPhase === "prompt-rewrite",
  async execute(job, context) {
    const stage: StageProvenance = {
      id: `${job.id}:prompt-rewrite`,
      capability: "text-rewrite",
      executionMode: "real",
      implementation: "aihubmix-chat-completions",
      provider: "aihubmix",
      model: VIDEO_REMIX_PROMPT_MODEL,
      startedAt: new Date().toISOString(),
    };
    try {
      const tool = job.values.promptTool as RemixPromptTool;
      const config = JSON.parse(job.values.promptToolConfig || "{}") as RemixPromptToolConfig;
      context.change(job.id, {
        status: "processing",
        stage: "AI 正在改写提示词",
        progress: 20,
        executionPlan: [stage],
        provenance: [stage],
        overallExecutionMode: "real",
      });
      const rewritten = await rewriteVideoRemixPrompt({ tool, config, prompt: job.values.originalPrompt || "" });
      stage.completedAt = new Date().toISOString();
      const values = {
        ...job.values,
        rewrittenPrompt: rewritten.prompt,
        rewriteSummary: rewritten.summary,
        rewriteFindings: JSON.stringify(rewritten.findings),
        rewriteModel: rewritten.model,
      };
      const result: JobResult = {
        kind: "video-remix-prompt-rewrite",
        title: job.title,
        summary: rewritten.summary,
        artifacts: [
          {
            id: crypto.randomUUID(),
            name: "rewritten-prompt.md",
            mimeType: "text/markdown",
            text: rewritten.prompt,
            executionMode: "real",
            lineage: [stage],
          },
        ],
        data: { values, generatedAt: new Date().toISOString(), mock: false },
      };
      context.change(job.id, {
        status: "succeeded",
        stage: "提示词改写完成",
        progress: 100,
        values,
        provenance: [stage],
        result,
        overallExecutionMode: "real",
      });
    } catch (error) {
      const modelError = error instanceof VideoRemixPromptModelError ? error : undefined;
      context.change(job.id, {
        status: "failed",
        stage: "提示词改写失败",
        provenance: [stage],
        error: {
          code: modelError?.code ?? "PROMPT_REWRITE_FAILED",
          message: modelError?.message ?? "提示词改写失败，请稍后重试",
          retryable: modelError?.retryable ?? true,
          requestId: crypto.randomUUID(),
        },
      });
    }
  },
};
