import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteJobStore } from "../../server/jobs/sqlite-job-store";
import type { JobRecord } from "../../server/types";
import { JobProcessor } from "../../worker/job-processor";
import { jobDefinitions } from "../../worker/jobs/definitions";
import { findJobHandler, jobHandlers } from "../../worker/jobs/registry";

const databases: string[] = [];
afterEach(() => {
  for (const path of databases.splice(0)) {
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});

function job(moduleId: JobRecord["moduleId"], values: Record<string, string> = {}): JobRecord {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    ownerUserId: crypto.randomUUID(),
    moduleId,
    title: "Worker Job",
    status: "queued",
    progress: 0,
    stage: "排队中",
    overallExecutionMode: "mock",
    values,
    executionPlan: [],
    provenance: [],
    cancelRequested: false,
    providerCancelState: "none",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("worker job registry", () => {
  test("routes each dedicated business flow to its own handler", () => {
    expect(findJobHandler(job("video-remix", { workflowPhase: "analysis" })).name).toBe("video-remix-analysis");
    expect(findJobHandler(job("video-remix", { workflowPhase: "compose" })).name).toBe("video-remix-compose");
    expect(findJobHandler(job("video-remix", { workflowPhase: "prompt-rewrite" })).name).toBe(
      "video-remix-prompt-rewrite",
    );
    expect(findJobHandler(job("video-remix", { workflowPhase: "shot-generation" })).name).toBe(
      "video-remix-shot-generation",
    );
    expect(findJobHandler(job("video-cut", { mergeMode: "video-cut-clips" })).name).toBe("video-clip-merge");
    expect(findJobHandler(job("video-cut")).name).toBe("video-cut");
    expect(findJobHandler(job("video-mashup")).name).toBe("video-mashup");
    expect(findJobHandler(job("voice-clone")).name).toBe("voice-clone");
    expect(findJobHandler(job("subtitle-erase")).name).toBe("mediakit-subtitle-erase");
    expect(findJobHandler(job("video-enhancement")).name).toBe("mediakit-video-enhancement");
    expect(findJobHandler(job("ad-script")).name).toBe("ad-script");
    expect(findJobHandler(job("ai-generate")).name).toBe("generic-creation");
    expect(findJobHandler(job("douyin-video-import")).name).toBe("share-content-import");
    expect(findJobHandler(job("share-content-import")).name).toBe("share-content-import");
  });

  test("share-content-import handler is registered before generic fallback", () => {
    const index = jobHandlers.findIndex((h) => h.name === "share-content-import");
    const fallbackIndex = jobHandlers.findIndex((h) => h.name === "generic-creation");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(fallbackIndex);
  });

  test("keeps the generic fallback last so dedicated handlers take precedence", () => {
    expect(jobHandlers.at(-1)?.name).toBe("generic-creation");
  });

  test("keeps one editable definition for every public module job", () => {
    expect(Object.keys(jobDefinitions).sort()).toEqual(
      [
        "video-remix",
        "video-create",
        "ad-script",
        "ai-generate",
        "video-cut",
        "media-understand",
        "video-mashup",
        "voice-clone",
        "video-renewal",
        "subtitle-erase",
        "video-enhancement",
        "video-extract",
        "video-editor",
        "kickart",
      ].sort(),
    );
  });

  test("dispatches a persisted job through JobProcessor and writes its terminal state", async () => {
    const path = join(tmpdir(), `worker-job-registry-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const store = new SqliteJobStore(path);
    const record = job("ai-generate", { __scenario: "insufficient-credits" });
    store.create(record);

    await new JobProcessor(store).process(record.id);

    expect(store.get(record.id)).toMatchObject({
      status: "failed",
      stage: "计费校验",
      error: { code: "INSUFFICIENT_CREDITS", retryable: false },
    });
    store.close();
  });
});
