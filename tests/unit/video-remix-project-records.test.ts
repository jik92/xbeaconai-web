import { describe, expect, test } from "bun:test";
import type { JobRecord } from "../../server/types";
import { summarizeRemixProject } from "../../server/video-remix/project-records";
import { parseRemixWorkspace } from "../../shared/video-remix/project-records";

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    ownerUserId: overrides.ownerUserId ?? "user-1",
    moduleId: "video-remix",
    title: overrides.title ?? "二创项目",
    status: overrides.status ?? "succeeded",
    progress: overrides.progress ?? 100,
    stage: overrides.stage ?? "完成",
    overallExecutionMode: overrides.overallExecutionMode ?? "real",
    values: overrides.values ?? {},
    executionPlan: overrides.executionPlan ?? [],
    provenance: overrides.provenance ?? [],
    result: overrides.result,
    error: overrides.error,
    parentJobId: overrides.parentJobId,
    cancelRequested: false,
    providerCancelState: "none",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt: overrides.createdAt ?? "2026-07-23T01:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-23T01:00:00.000Z",
  };
}

describe("video remix project records", () => {
  test("recovers invalid workspace data and hydrates the analysis prompt", () => {
    const workspace = parseRemixWorkspace(
      "{not-json",
      ["source-1"],
      [{ assetId: "source-1", name: "source.mp4", status: "succeeded", prompt: "原始解析提示词" }],
    );

    expect(workspace.stage).toBe(2);
    expect(workspace.selectedShotAssets).toEqual({ "source-1": "source-1" });
    expect(workspace.composeOrder).toEqual(["source-1"]);
    expect(workspace.promptStates["source-1"]).toEqual({
      prompt: "原始解析提示词",
      versions: [{ id: "analysis:source-1", label: "AI解析", prompt: "原始解析提示词" }],
      activeVersionId: "analysis:source-1",
    });
  });

  test("normalizes invalid composition order and clamps the workspace stage", () => {
    const workspace = parseRemixWorkspace(
      JSON.stringify({ stage: 99, composeOrder: ["source-1"], composePreviewId: "missing" }),
      ["source-1", "source-2"],
      [],
    );

    expect(workspace.stage).toBe(4);
    expect(workspace.composeOrder).toEqual(["source-1", "source-2"]);
    expect(workspace.composePreviewId).toBe("source-1");
  });

  test("summarizes generated shots and a completed composition", () => {
    const root = job({
      id: "root-1",
      values: {
        workflowPhase: "analysis",
        productName: "草帽",
        sources: JSON.stringify([
          { assetId: "source-1", name: "one.mp4" },
          { assetId: "source-2", name: "two.mp4" },
        ]),
        workspaceState: JSON.stringify({ stage: 3 }),
      },
    });
    const children = [
      job({
        parentJobId: root.id,
        values: { workflowPhase: "shot-generation", sourceAssetId: "source-1" },
      }),
      job({
        parentJobId: root.id,
        values: { workflowPhase: "compose" },
        updatedAt: "2026-07-23T02:00:00.000Z",
      }),
    ];

    expect(summarizeRemixProject(root, children, "测试用户")).toEqual(
      expect.objectContaining({
        id: root.id,
        productName: "草帽",
        currentStage: "completed",
        sourceCount: 2,
        generatedCount: 1,
        createdBy: "测试用户",
        updatedAt: "2026-07-23T02:00:00.000Z",
      }),
    );
  });
});
