import { z } from "@hono/zod-openapi";

export const AD_SCRIPT_MODEL = "deepseek/deepseek-v4-pro" as const;
export const AD_SCRIPT_PROVIDER_MODEL = "deepseek-v4-pro" as const;
export const AD_SCRIPT_CREDITS_PER_VARIANT = 20;
export const AD_SCRIPT_TARGET_SCORE = 85;
export const AD_SCRIPT_MAX_ROUNDS = 5;
export const AD_SCRIPT_OPERATION_BUDGET_MS = 55_000;

export const AdScriptSceneCategorySchema = z.enum(["marketing", "placement"]);
export const AdScriptLengthSchema = z.enum(["60-80", "80-120", "100-150", "150-200", "200-250", "250-350"]);
export const AdScriptProjectStatusSchema = z.enum([
  "draft",
  "queued",
  "processing",
  "succeeded",
  "partially_succeeded",
  "failed",
  "cancelled",
]);
export const AdScriptVariantStatusSchema = z.enum(["queued", "processing", "succeeded", "failed", "cancelled"]);
export const AdScriptVersionSourceSchema = z.enum(["initial", "optimized", "human"]);

export const AdScriptInputSchema = z
  .object({
    sceneCategory: AdScriptSceneCategorySchema,
    sceneId: z.string().trim().min(1).max(40),
    batchCount: z.number().int().min(1).max(3),
    productName: z.string().trim().min(1).max(30),
    sellingPoints: z.array(z.string().trim().min(1).max(80)).min(1).max(6),
    targetLength: AdScriptLengthSchema,
    marketingGoal: z.string().trim().min(1).max(40),
    targetAudience: z.string().trim().min(1).max(80),
    painPoints: z.string().trim().max(150).default(""),
    benefits: z.string().trim().max(100).default(""),
    speakerRole: z.string().trim().min(1).max(40),
    customRole: z.string().trim().max(100).default(""),
    scriptStyle: z.string().trim().min(1).max(40),
    openingStyle: z.string().trim().min(1).max(40),
    sourceScript: z.string().trim().max(10_000).default(""),
    useSourceAsReference: z.boolean().default(false),
  })
  .openapi("AdScriptInput");

export const AdScriptScoresSchema = z
  .object({
    openingAttraction: z.number().int().min(0).max(25),
    painResonance: z.number().int().min(0).max(25),
    benefitClarity: z.number().int().min(0).max(25),
    callToAction: z.number().int().min(0).max(25),
  })
  .openapi("AdScriptScores");

export const AdScriptScoreDetailSchema = z
  .object({
    scores: AdScriptScoresSchema,
    total: z.number().int().min(0).max(100),
    suggestions: z.array(z.string().max(500)).max(12),
  })
  .openapi("AdScriptScoreDetail");

export const AdScriptComplianceFindingSchema = z
  .object({
    ruleId: z.string(),
    severity: z.enum(["warning", "blocking"]),
    source: z.enum(["local", "ai"]),
    excerpt: z.string(),
    start: z.number().int().nonnegative().optional(),
    end: z.number().int().nonnegative().optional(),
    message: z.string(),
    suggestion: z.string(),
  })
  .openapi("AdScriptComplianceFinding");

export const AdScriptComplianceSchema = z
  .object({
    passed: z.boolean(),
    findings: z.array(AdScriptComplianceFindingSchema),
  })
  .openapi("AdScriptCompliance");

export const AdScriptExtractedInputSchema = z
  .object({
    productName: z.string().max(30),
    sellingPoints: z.array(z.string().max(80)).max(6),
    marketingGoal: z.string().max(40),
    targetAudience: z.string().max(80),
    painPoints: z.string().max(150),
    benefits: z.string().max(100),
  })
  .openapi("AdScriptExtractedInput");

export type AdScriptInput = z.infer<typeof AdScriptInputSchema>;
export type AdScriptScores = z.infer<typeof AdScriptScoresSchema>;
export type AdScriptScoreDetail = z.infer<typeof AdScriptScoreDetailSchema>;
export type AdScriptCompliance = z.infer<typeof AdScriptComplianceSchema>;
export type AdScriptExtractedInput = z.infer<typeof AdScriptExtractedInputSchema>;

export function totalScore(scores: AdScriptScores) {
  return scores.openingAttraction + scores.painResonance + scores.benefitClarity + scores.callToAction;
}

export function targetLengthBounds(value: AdScriptInput["targetLength"]): [number, number] {
  const [minimum, maximum] = value.split("-").map(Number);
  return [minimum, maximum];
}

export function shouldStopAdScriptOptimization(score: number, compliancePassed: boolean, round: number) {
  return (score >= AD_SCRIPT_TARGET_SCORE && compliancePassed) || round >= AD_SCRIPT_MAX_ROUNDS;
}

export function nextAdScriptOptimizationRound(score: number, compliancePassed: boolean, round: number) {
  if (shouldStopAdScriptOptimization(score, compliancePassed, round)) return undefined;
  const next = round + 1;
  return next <= AD_SCRIPT_MAX_ROUNDS ? next : undefined;
}
