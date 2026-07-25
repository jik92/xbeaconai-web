import { describe, expect, test } from "bun:test";
import { resolveWorkerConcurrencies } from "../../server/env";
import { classifyJobWorkload, type JobWorkloadDescriptor } from "../../shared/jobs/job-workload";
import { jobQueueName } from "../../shared/jobs/queue-contract";

const job = (
  moduleId: string,
  values: Record<string, string> = {},
  executionPlan?: JobWorkloadDescriptor["executionPlan"],
): JobWorkloadDescriptor => ({ moduleId, values, executionPlan });

describe("worker concurrency pools", () => {
  test("routes local media processing jobs to the ffmpeg pool", () => {
    expect(classifyJobWorkload(job("video-cut"))).toBe("ffmpeg");
    expect(classifyJobWorkload(job("video-mashup"))).toBe("ffmpeg");
    expect(classifyJobWorkload(job("video-editor"))).toBe("ffmpeg");
    expect(classifyJobWorkload(job("video-remix", { workflowPhase: "analysis" }))).toBe("ffmpeg");
    expect(classifyJobWorkload(job("video-remix", { workflowPhase: "compose" }))).toBe("ffmpeg");
    expect(classifyJobWorkload(job("video-create", { operation: "audio-replace" }))).toBe("ffmpeg");
    expect(classifyJobWorkload(job("video-create", { operation: "subtitle-compose" }))).toBe("ffmpeg");
    expect(classifyJobWorkload(job("video-create", { operation: "compose" }))).toBe("ffmpeg");
    expect(classifyJobWorkload(job("video-create", { operation: "shot", subtitleEnabled: "true" }))).toBe("ffmpeg");
    expect(classifyJobWorkload(job("ai-generate", {}, [{ implementation: "ffmpeg-seedance-mock" }]))).toBe("ffmpeg");
  });

  test("keeps network and ffprobe-only jobs in the shared network pool", () => {
    expect(classifyJobWorkload(job("voice-clone"))).toBe("network");
    expect(classifyJobWorkload(job("douyin-video-import"))).toBe("network");
    expect(classifyJobWorkload(job("video-extract"))).toBe("network");
    expect(classifyJobWorkload(job("subtitle-erase"))).toBe("network");
    expect(classifyJobWorkload(job("video-enhancement"))).toBe("network");
    expect(classifyJobWorkload(job("video-remix", { workflowPhase: "prompt-rewrite" }))).toBe("network");
    expect(classifyJobWorkload(job("video-remix", { workflowPhase: "shot-generation" }))).toBe("network");
    expect(classifyJobWorkload(job("video-create", { operation: "shot", subtitleEnabled: "false" }))).toBe("network");
    expect(classifyJobWorkload(job("video-create", { operation: "audio-generate" }))).toBe("network");
    expect(classifyJobWorkload(job("ad-script"))).toBe("network");
  });

  test("uses explicit pool defaults and supports the legacy concurrency fallback", () => {
    expect(resolveWorkerConcurrencies({})).toEqual({ network: 40, ffmpeg: 2 });
    expect(resolveWorkerConcurrencies({ network: "48", ffmpeg: "3", legacy: "7" })).toEqual({
      network: 48,
      ffmpeg: 3,
    });
    expect(resolveWorkerConcurrencies({ legacy: "6" })).toEqual({ network: 6, ffmpeg: 6 });
    expect(resolveWorkerConcurrencies({ network: "0", ffmpeg: "invalid" })).toEqual({ network: 40, ffmpeg: 2 });
  });

  test("derives two stable queue names from the configured base", () => {
    expect(jobQueueName("yaozuo-jobs", "network")).toBe("yaozuo-jobs-network");
    expect(jobQueueName("yaozuo-jobs", "ffmpeg")).toBe("yaozuo-jobs-ffmpeg");
  });

  test("deploys the requested production concurrency defaults", async () => {
    const deploy = await Bun.file("deploy.sh").text();
    expect(deploy).toContain(`upsert_env "NETWORK_WORKER_CONCURRENCY" "\${NETWORK_WORKER_CONCURRENCY:-40}"`);
    expect(deploy).toContain(`upsert_env "FFMPEG_WORKER_CONCURRENCY" "\${FFMPEG_WORKER_CONCURRENCY:-2}"`);
  });
});
