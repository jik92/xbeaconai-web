import { checkAdScriptCompliance } from "../server/ad-script/compliance";
import { generateScoredInitialScript, optimizeScoredScript } from "../server/ad-script/model";
import {
  AD_SCRIPT_MODEL,
  AD_SCRIPT_OPERATION_BUDGET_MS,
  type AdScriptCompliance,
  type AdScriptInput,
  shouldStopAdScriptOptimization,
} from "../server/ad-script/types";

const input: AdScriptInput = {
  sceneCategory: "marketing",
  sceneId: "local-store",
  batchCount: 1,
  productName: "轻盈咖啡",
  sellingPoints: ["现磨咖啡豆", "到店可领取试饮"],
  targetLength: "80-120",
  marketingGoal: "门店到店",
  targetAudience: "附近写字楼的上班族",
  painPoints: "下午容易困，普通速溶咖啡风味单一",
  benefits: "现磨香气和便捷到店体验",
  speakerRole: "普通用户",
  customRole: "",
  scriptStyle: "情绪共鸣",
  openingStyle: "痛点直击",
  sourceScript: "",
  useSourceAsReference: false,
};

function mergeCompliance(local: AdScriptCompliance, ai: AdScriptCompliance): AdScriptCompliance {
  const findings = [...local.findings, ...ai.findings];
  return { passed: !findings.some((finding) => finding.severity === "blocking"), findings };
}

const startedAt = Date.now();
const deadlineAt = startedAt + AD_SCRIPT_OPERATION_BUDGET_MS;
const initialStartedAt = Date.now();
const initial = await generateScoredInitialScript(input, 1, deadlineAt);
let compliance = mergeCompliance(checkAdScriptCompliance(initial.script, input), initial.aiCompliance);
const stages: Array<Record<string, boolean | number | string>> = [
  {
    stage: "generate-and-score",
    durationMs: Date.now() - initialStartedAt,
    score: initial.score.total,
    compliant: compliance.passed,
  },
];

if (!shouldStopAdScriptOptimization(initial.score.total, compliance.passed, 0)) {
  const optimizeStartedAt = Date.now();
  const optimized = await optimizeScoredScript(
    { script: initial.script, projectInput: input, score: initial.score, compliance, round: 1 },
    deadlineAt,
  );
  compliance = mergeCompliance(checkAdScriptCompliance(optimized.script, input), optimized.aiCompliance);
  stages.push({
    stage: "optimize-and-score",
    durationMs: Date.now() - optimizeStartedAt,
    score: optimized.score.total,
    compliant: compliance.passed,
  });
}

console.log(
  JSON.stringify({
    model: AD_SCRIPT_MODEL,
    budgetMs: AD_SCRIPT_OPERATION_BUDGET_MS,
    totalDurationMs: Date.now() - startedAt,
    withinBudget: Date.now() <= deadlineAt,
    stages,
  }),
);
