import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountStore } from "../../server/accounts/account-store";
import { AdScriptStore, AdScriptVersionConflictError } from "../../server/ad-script/ad-script-store";
import { checkAdScriptCompliance } from "../../server/ad-script/compliance";
import { parseAdScriptModelJson } from "../../server/ad-script/model";
import {
  AD_SCRIPT_OPERATION_BUDGET_MS,
  type AdScriptInput,
  nextAdScriptOptimizationRound,
  shouldStopAdScriptOptimization,
  targetLengthBounds,
  totalScore,
} from "../../server/ad-script/types";
import type { JobRecord } from "../../server/types";

const databases: string[] = [];
afterEach(() => {
  for (const path of databases.splice(0)) {
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});

const input: AdScriptInput = {
  sceneCategory: "marketing",
  sceneId: "local-store",
  batchCount: 2,
  productName: "轻盈咖啡",
  sellingPoints: ["现磨咖啡豆", "到店可领取试饮"],
  targetLength: "60-80",
  marketingGoal: "门店到店",
  targetAudience: "附近上班族",
  painPoints: "下午容易困",
  benefits: "现磨香气和便捷到店",
  speakerRole: "好物推荐员",
  customRole: "",
  scriptStyle: "种草口吻",
  openingStyle: "痛点直击",
  sourceScript: "",
  useSourceAsReference: false,
};

function job(ownerUserId: string, idempotencyKey: string): JobRecord {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    ownerUserId,
    moduleId: "ad-script",
    title: "口播脚本任务",
    status: "queued",
    progress: 0,
    stage: "排队中",
    overallExecutionMode: "real",
    values: { operation: "generate" },
    executionPlan: [],
    provenance: [],
    idempotencyKey,
    cancelRequested: false,
    providerCancelState: "none",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("ad script domain", () => {
  test("calculates stable score, length and stop rules", () => {
    expect(totalScore({ openingAttraction: 22, painResonance: 21, benefitClarity: 20, callToAction: 22 })).toBe(85);
    expect(targetLengthBounds("100-150")).toEqual([100, 150]);
    expect(shouldStopAdScriptOptimization(85, true, 2)).toBe(true);
    expect(shouldStopAdScriptOptimization(95, false, 4)).toBe(false);
    expect(shouldStopAdScriptOptimization(40, false, 5)).toBe(true);
    expect(AD_SCRIPT_OPERATION_BUDGET_MS).toBe(55_000);
    expect(nextAdScriptOptimizationRound(80, false, 0)).toBe(1);
    expect(nextAdScriptOptimizationRound(80, false, 4)).toBe(5);
    expect(nextAdScriptOptimizationRound(85, true, 2)).toBeUndefined();
    expect(nextAdScriptOptimizationRound(80, false, 5)).toBeUndefined();
  });

  test("finds deterministic advertising risks, length and CTA failures", () => {
    const result = checkAdScriptCompliance("这是全世界最好的咖啡，保证喝完立刻见效。", input);
    expect(result.passed).toBe(false);
    expect(result.findings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining(["absolute-claim", "guaranteed-result", "length-range", "missing-cta"]),
    );
  });

  test("extracts JSON from fenced model output", () => {
    expect(parseAdScriptModelJson('```json\n{"script":"可用脚本"}\n```')).toEqual({ script: "可用脚本" });
    expect(() => parseAdScriptModelJson("没有 JSON")).toThrow("JSON_OBJECT_NOT_FOUND");
  });

  test("isolates owners, versions batches, and only refunds a fully failed batch once", async () => {
    const path = join(tmpdir(), `ad-script-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const accounts = new AccountStore(path);
    const store = new AdScriptStore(path);
    const registration = await accounts.register({
      email: "ad-script@example.com",
      password: "Password123",
      displayName: "脚本用户",
    });
    const otherUser = await accounts.register({
      email: "ad-script-other@example.com",
      password: "Password123",
      displayName: "其他用户",
    });
    const record = job(registration.user.id, "ad-script-create-1");
    const projectId = crypto.randomUUID();
    const aggregate = store.createCharged({
      projectId,
      ownerUserId: registration.user.id,
      projectInput: input,
      idempotencyKey: "ad-script-create-1",
      job: record,
    });
    expect(aggregate.variants).toHaveLength(2);
    expect(store.getOwned(projectId, otherUser.user.id)).toBeUndefined();
    expect(accounts.getUser(registration.user.id)?.credits).toBe(2440);

    const variant = aggregate.variants[0];
    const score = {
      scores: { openingAttraction: 20, painResonance: 20, benefitClarity: 20, callToAction: 20 },
      total: 80,
      suggestions: ["强化行动指引"],
    };
    const compliance = { passed: true, findings: [] };
    const initial = store.appendVersion({
      variantId: variant.id,
      source: "initial",
      round: 0,
      script: "这是一条长度合适并且引导附近上班族现在到店领取咖啡试饮的口播脚本，突出真实现磨和便利体验。",
      score,
      compliance,
      changeSummary: "初稿",
    });
    const human = store.saveHumanVersion({
      projectId,
      variantId: variant.id,
      ownerUserId: registration.user.id,
      expectedVersionId: initial.id,
      script: `${initial.script}欢迎来试试。`,
      score,
      compliance,
    });
    expect(human?.sequence).toBe(2);
    expect(() =>
      store.saveHumanVersion({
        projectId,
        variantId: variant.id,
        ownerUserId: registration.user.id,
        expectedVersionId: initial.id,
        script: initial.script,
        score,
        compliance,
      }),
    ).toThrow(AdScriptVersionConflictError);

    store.updateProject(projectId, { status: "failed" });
    store.updateVariant(variant.id, { status: "failed" });
    store.updateVariant(aggregate.variants[1].id, { status: "failed" });
    expect(store.refundFullyFailed(record.id)?.amount).toBe(40);
    expect(store.refundFullyFailed(record.id)?.amount).toBe(40);
    expect(accounts.getUser(registration.user.id)?.credits).toBe(2480);

    const partialJob = job(registration.user.id, "ad-script-create-partial");
    const partialProjectId = crypto.randomUUID();
    const partial = store.createCharged({
      projectId: partialProjectId,
      ownerUserId: registration.user.id,
      projectInput: input,
      idempotencyKey: "ad-script-create-partial",
      job: partialJob,
    });
    store.updateProject(partialProjectId, { status: "partially_succeeded" });
    store.updateVariant(partial.variants[0].id, { status: "succeeded" });
    store.updateVariant(partial.variants[1].id, { status: "failed" });
    expect(store.refundFullyFailed(partialJob.id)).toBeUndefined();
    expect(accounts.getUser(registration.user.id)?.credits).toBe(2440);
    store.close();
    accounts.close();
  });
});
