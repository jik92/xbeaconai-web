import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteJobStore } from "../../server/jobs/sqlite-job-store";
import { defaultVideoModelId, seedanceModelIds, videoModels } from "../../server/models/video-models";
import { auditSdkRegistry } from "../../server/sdk-registry";
import type { JobRecord } from "../../server/types";

const tempDirs: string[] = [];
afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("Seedance model integration", () => {
  test("has exactly the three approved models and Fast as the only default", () => {
    expect(videoModels.map((model) => model.id)).toEqual([...seedanceModelIds]);
    expect(videoModels.filter((model) => model.isDefault).map((model) => model.id)).toEqual([defaultVideoModelId]);
    expect(
      auditSdkRegistry()
        .filter((item) => item.capability === "video-generate")
        .map((item) => item.model),
    ).toEqual([...seedanceModelIds]);
    expect(auditSdkRegistry().some((item) => item.model === "wan2.6-t2v")).toBe(false);
  });

  test("keeps the OpenAPI request enum and generated SDK aligned", async () => {
    const openapi = (await Bun.file(resolve(process.cwd(), "openapi/openapi.json")).json()) as any;
    expect(openapi.components.schemas.SeedanceModelId.enum).toEqual([...seedanceModelIds]);
    const generated = await Bun.file(resolve(process.cwd(), "src/api/generated/types.gen.ts")).text();
    for (const id of seedanceModelIds) expect(generated).toContain(`'${id}'`);
    expect(generated).toContain("videoModel?: SeedanceModelId");
  });

  test("retires nonterminal Wan jobs without rewriting terminal history", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "yaozuo-seedance-test-"));
    tempDirs.push(dir);
    const path = resolve(dir, "jobs.sqlite");
    const first = new SqliteJobStore(path);
    const now = new Date().toISOString();
    const base: JobRecord = {
      id: crypto.randomUUID(),
      ownerUserId: "owner",
      moduleId: "video-remix",
      title: "legacy",
      status: "queued",
      progress: 20,
      stage: "画面生成",
      overallExecutionMode: "real",
      values: {},
      executionPlan: [
        {
          id: "wan",
          capability: "video-generate",
          executionMode: "real",
          implementation: "aihubmix-video",
          provider: "aihubmix",
          model: "wan2.6-t2v",
          startedAt: now,
        },
      ],
      provenance: [],
      cancelRequested: false,
      stagingKeys: [],
      jobSchemaVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    first.create(base);
    first.create({ ...base, id: crypto.randomUUID(), status: "succeeded", progress: 100, stage: "已完成" });
    first.db.close();
    const migrated = new SqliteJobStore(path);
    const jobs = migrated.db.query("SELECT status,error_json FROM jobs ORDER BY created_at,id").all() as Array<{
      status: string;
      error_json: string | null;
    }>;
    expect(jobs.some((job) => job.status === "failed" && job.error_json?.includes("MODEL_RETIRED"))).toBe(true);
    expect(jobs.some((job) => job.status === "succeeded")).toBe(true);
    migrated.db.close();
  });
});
