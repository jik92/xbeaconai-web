import { z } from "@hono/zod-openapi";
import { aihubmix } from "../providers/aihubmix";
import {
  AD_SCRIPT_MODEL,
  AD_SCRIPT_PROVIDER_MODEL,
  type AdScriptCompliance,
  AdScriptComplianceFindingSchema,
  type AdScriptExtractedInput,
  AdScriptExtractedInputSchema,
  type AdScriptInput,
  type AdScriptScoreDetail,
  AdScriptScoresSchema,
  totalScore,
} from "./types";

const SemanticFindingWithoutSourceSchema = AdScriptComplianceFindingSchema.omit({ source: true });
const RecoverableSemanticFindingSchema = z.union([
  SemanticFindingWithoutSourceSchema,
  z
    .string()
    .trim()
    .min(1)
    .max(1_000)
    .transform((message) => ({
      ruleId: "ai-semantic-risk",
      severity: "warning" as const,
      excerpt: "",
      message,
      suggestion: "请人工复核相关表述",
    })),
]);
const EvaluationSchema = AdScriptScoresSchema.extend({
  suggestions: z.array(z.string().max(500)).max(12),
  semanticFindings: RecoverableSemanticFindingSchema.array().max(12),
});
const ScriptSchema = z.object({ script: z.string().min(20).max(4_000) });
const OptimizedScriptSchema = ScriptSchema.extend({ changeSummary: z.string().min(1).max(1_000) });
const ScoredScriptSchema = ScriptSchema.extend(EvaluationSchema.shape);
const ScoredOptimizedScriptSchema = OptimizedScriptSchema.extend(EvaluationSchema.shape);
const semanticFindingsContract = `semanticFindings 必须是数组。每项必须是对象：{"ruleId":"规则标识","severity":"warning 或 blocking","excerpt":"原文摘录","message":"风险说明","suggestion":"修改建议"}，start/end 为可选非负整数。没有风险时返回 []；禁止返回字符串数组。`;

let modelCheck: { expiresAt: number; available: boolean } | undefined;

export class AdScriptModelError extends Error {
  constructor(
    readonly code: "MODEL_NOT_AVAILABLE" | "MODEL_OUTPUT_INVALID" | "MODEL_PROVIDER_ERROR" | "MODEL_TIMEOUT",
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export function parseAdScriptModelJson(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("JSON_OBJECT_NOT_FOUND");
  return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
}

export function parseAdScriptModelEvaluation(value: unknown) {
  return EvaluationSchema.parse(value);
}

function remainingBudget(deadlineAt?: number) {
  if (!deadlineAt) return undefined;
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new AdScriptModelError("MODEL_TIMEOUT", "口播脚本模型调用超过 55 秒预算", true);
  return remaining;
}

export async function assertAdScriptModelAvailable(deadlineAt?: number) {
  if (!aihubmix.configured) throw new AdScriptModelError("MODEL_NOT_AVAILABLE", "DeepSeek 模型服务未配置", false);
  if (modelCheck && modelCheck.expiresAt > Date.now()) {
    if (!modelCheck.available)
      throw new AdScriptModelError("MODEL_NOT_AVAILABLE", `模型 ${AD_SCRIPT_MODEL} 当前不可用`, false);
    return;
  }
  try {
    const models = await aihubmix.listModels(remainingBudget(deadlineAt));
    const available = models.some((model) => model.model_id === AD_SCRIPT_PROVIDER_MODEL);
    modelCheck = { available, expiresAt: Date.now() + 5 * 60_000 };
    if (!available) throw new AdScriptModelError("MODEL_NOT_AVAILABLE", `模型 ${AD_SCRIPT_MODEL} 当前不可用`, false);
  } catch (error) {
    if (error instanceof AdScriptModelError) throw error;
    const message = error instanceof Error ? error.message : "无法验证 DeepSeek 模型状态";
    if (/timeout|timed out|abort/i.test(message)) throw new AdScriptModelError("MODEL_TIMEOUT", message, true);
    throw new AdScriptModelError("MODEL_PROVIDER_ERROR", message, true);
  }
}

export async function generateStructured<T>(
  prompt: string,
  schema: z.ZodType<T>,
  options: { maxTokens?: number; deadlineAt?: number } = {},
): Promise<T> {
  await assertAdScriptModelAvailable(options.deadlineAt);
  let repairContext = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await aihubmix.generateText(`${prompt}${repairContext}`, AD_SCRIPT_PROVIDER_MODEL, {
        maxTokens: (options.maxTokens ?? 1_500) * (attempt + 1),
        temperature: attempt === 0 ? 0.45 : 0,
        json: true,
        timeoutMs: remainingBudget(options.deadlineAt),
      });
      return schema.parse(parseAdScriptModelJson(response.text));
    } catch (error) {
      if (error instanceof AdScriptModelError) throw error;
      const message = error instanceof Error ? error.message : "模型输出无法解析";
      if (message === "AIHUBMIX_INVALID_TEXT_RESULT" && attempt === 0) {
        repairContext = "\n上一次响应在给出 JSON 前被截断。直接输出 JSON，不要解释或展示思考过程。";
        continue;
      }
      if (/timeout|timed out|abort/i.test(message)) throw new AdScriptModelError("MODEL_TIMEOUT", message, true);
      if (/AIHUBMIX_|fetch|network/i.test(message)) throw new AdScriptModelError("MODEL_PROVIDER_ERROR", message, true);
      if (attempt === 0) {
        repairContext = "\n上一次输出无法通过 JSON Schema 校验。只返回一个完整 JSON 对象，不要 Markdown。";
        continue;
      }
      console.warn("[ad-script-model] structured output remained invalid after retry", {
        reason: message.slice(0, 1_000),
      });
      throw new AdScriptModelError("MODEL_OUTPUT_INVALID", "模型返回格式不稳定，系统已自动重试；请重新生成", true);
    }
  }
  throw new AdScriptModelError("MODEL_OUTPUT_INVALID", "模型输出无法解析", true);
}

function scoredResult(evaluation: z.infer<typeof ScoredScriptSchema>) {
  const scores = {
    openingAttraction: evaluation.openingAttraction,
    painResonance: evaluation.painResonance,
    benefitClarity: evaluation.benefitClarity,
    callToAction: evaluation.callToAction,
  };
  return {
    script: evaluation.script,
    score: { scores, total: totalScore(scores), suggestions: evaluation.suggestions },
    aiCompliance: {
      passed: !evaluation.semanticFindings.some((finding) => finding.severity === "blocking"),
      findings: evaluation.semanticFindings.map((finding) => ({ ...finding, source: "ai" as const })),
    },
  };
}

export async function generateScoredInitialScript(input: AdScriptInput, variantOrdinal: number, deadlineAt: number) {
  const result = await generateStructured(
    `你是专业中文短视频口播编导和严格评审。生成第 ${variantOrdinal} 个差异化脚本，并在同一次响应中完成四维评分和语义广告风险检测。
每项评分为 0-25 整数。严格返回：{"script":"...","openingAttraction":0,"painResonance":0,"benefitClarity":0,"callToAction":0,"suggestions":[],"semanticFindings":[]}。
${semanticFindingsContract}
脚本需符合目标字数，包含明确但不过度承诺的 CTA，避免绝对化和保证性表达。输入：${JSON.stringify(input)}`,
    ScoredScriptSchema,
    { maxTokens: 2_400, deadlineAt },
  );
  return scoredResult(result);
}

export async function optimizeScoredScript(
  input: {
    script: string;
    projectInput: AdScriptInput;
    score: AdScriptScoreDetail;
    compliance: AdScriptCompliance;
    round: number;
  },
  deadlineAt: number,
) {
  const result = await generateStructured(
    `你是中文短视频口播改稿专家和严格评审。根据问题改写脚本，并在同一次响应中重新完成四维评分和语义广告风险检测。
每项评分为 0-25 整数。严格返回：{"script":"...","changeSummary":"...","openingAttraction":0,"painResonance":0,"benefitClarity":0,"callToAction":0,"suggestions":[],"semanticFindings":[]}。
${semanticFindingsContract}
保留事实，不虚构证明材料。这是第 ${input.round} 轮。业务输入：${JSON.stringify(input.projectInput)}
当前评分：${JSON.stringify(input.score)}
合规问题：${JSON.stringify(input.compliance.findings)}
当前脚本：${input.script}`,
    ScoredOptimizedScriptSchema,
    { maxTokens: 2_600, deadlineAt },
  );
  return { ...scoredResult(result), changeSummary: result.changeSummary };
}

export function extractSourceScript(sourceScript: string, deadlineAt?: number): Promise<AdScriptExtractedInput> {
  return generateStructured(
    `你是中文广告脚本信息抽取器。分析下列口播或竞品脚本，严格返回 JSON：
{"productName":"","sellingPoints":[],"marketingGoal":"","targetAudience":"","painPoints":"","benefits":""}
不得虚构原文没有的信息，缺失字段使用空字符串或空数组。脚本：\n${sourceScript}`,
    AdScriptExtractedInputSchema,
    { maxTokens: 1_200, deadlineAt },
  );
}

export function generateInitialScript(input: AdScriptInput, variantOrdinal: number): Promise<{ script: string }> {
  return generateStructured(
    `你是专业中文短视频口播编导。根据输入生成第 ${variantOrdinal} 个差异化初稿，只返回 {"script":"..."}。
要求自然可直接拍摄，符合目标字数，包含明确但不过度承诺的 CTA，避免绝对化和保证性表达。
输入：${JSON.stringify(input)}`,
    ScriptSchema,
    { maxTokens: 1_600 },
  );
}

export async function evaluateScript(
  script: string,
  input: AdScriptInput,
  deadlineAt?: number,
): Promise<{ score: AdScriptScoreDetail; aiCompliance: AdScriptCompliance }> {
  const evaluation = await generateStructured(
    `你是严格的中文广告脚本评审。每项只能给 0-25 整数分，并提供具体建议和仅靠语义才能发现的广告风险。
严格返回：{"openingAttraction":0,"painResonance":0,"benefitClarity":0,"callToAction":0,"suggestions":[],"semanticFindings":[]}
${semanticFindingsContract}
不要重复简单极限词规则。
业务输入：${JSON.stringify(input)}\n脚本：${script}`,
    EvaluationSchema,
    { maxTokens: 2_000, deadlineAt },
  );
  const scores = {
    openingAttraction: evaluation.openingAttraction,
    painResonance: evaluation.painResonance,
    benefitClarity: evaluation.benefitClarity,
    callToAction: evaluation.callToAction,
  };
  return {
    score: { scores, total: totalScore(scores), suggestions: evaluation.suggestions },
    aiCompliance: {
      passed: !evaluation.semanticFindings.some((finding) => finding.severity === "blocking"),
      findings: evaluation.semanticFindings.map((finding) => ({ ...finding, source: "ai" as const })),
    },
  };
}

export function optimizeScript(input: {
  script: string;
  projectInput: AdScriptInput;
  score: AdScriptScoreDetail;
  compliance: AdScriptCompliance;
  round: number;
}): Promise<{ script: string; changeSummary: string }> {
  return generateStructured(
    `你是中文短视频口播改稿专家。根据评分和合规问题改写脚本。保留事实，不虚构证明材料。
严格返回 {"script":"...","changeSummary":"..."}。
这是第 ${input.round} 轮。业务输入：${JSON.stringify(input.projectInput)}
当前评分：${JSON.stringify(input.score)}
合规问题：${JSON.stringify(input.compliance.findings)}
当前脚本：${input.script}`,
    OptimizedScriptSchema,
    { maxTokens: 1_800 },
  );
}
