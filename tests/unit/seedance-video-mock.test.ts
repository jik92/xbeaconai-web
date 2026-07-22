import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { env } from "../../server/env";
import { SqliteJobStore } from "../../server/jobs/sqlite-job-store";
import {
  generateNumberedMockVideo,
  mockVideoDimensions,
  probeMedia,
  randomTwoDigitNumber,
} from "../../server/media/ffmpeg";
import type { JobRecord } from "../../server/types";
import { JobProcessor } from "../../worker/job-processor";
import { buildExecutionPlan } from "../../worker/jobs/job-generic-creation";
import { SeedanceVideoJob, seedanceVideoSettings } from "../../worker/jobs/job-seedance-video";

const directories: string[] = [];
const generatedFiles: string[] = [];
const originalMockGenerateVideoApi = env.mockGenerateVideoApi;

afterEach(async () => {
  env.mockGenerateVideoApi = originalMockGenerateVideoApi;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  await Promise.all(generatedFiles.splice(0).map((path) => unlink(path).catch(() => undefined)));
});

function createJob(id: string): JobRecord {
  const timestamp = new Date().toISOString();
  return {
    id,
    ownerUserId: crypto.randomUUID(),
    moduleId: "ai-generate",
    title: "Seedance FFmpeg Mock",
    status: "queued",
    progress: 0,
    stage: "排队中",
    overallExecutionMode: "mock",
    values: { type: "视频", duration: "7", ratio: "9:16", prompt: "测试视频" },
    videoModel: "doubao-seedance-2-0-fast-260128",
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

describe("Seedance FFmpeg mock", () => {
  test("normalizes Seedance duration and ratio consistently", () => {
    expect(seedanceVideoSettings({ duration: "7", ratio: "9:16" })).toEqual({
      duration: 7,
      ratio: "9:16",
      resolution: "720p",
    });
    expect(seedanceVideoSettings({ durationSec: "99", ratio: "1:1 custom", resolution: "480p" })).toEqual({
      duration: 15,
      ratio: "1:1",
      resolution: "480p",
    });
    expect(seedanceVideoSettings({ duration: "invalid", ratio: "adaptive" })).toEqual({
      duration: 5,
      ratio: "16:9",
      resolution: "720p",
    });
    expect(mockVideoDimensions("16:9")).toEqual({ width: 1280, height: 720 });
    expect(mockVideoDimensions("9:16")).toEqual({ width: 720, height: 1280 });
    expect(mockVideoDimensions("1:1")).toEqual({ width: 720, height: 720 });
    expect(mockVideoDimensions("16:9", "480p")).toEqual({ width: 854, height: 480 });
    for (let index = 0; index < 100; index += 1) expect(randomTwoDigitNumber()).toBeWithin(10, 100);
  });

  const run = Bun.which("ffmpeg") && Bun.which("ffprobe") ? test : test.skip;
  run(
    "generates a numbered H.264 video with matching duration, dimensions and silent audio",
    async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "seedance-numbered-mock-"));
      directories.push(directory);
      const output = resolve(directory, "mock-42.mp4");
      const generated = await generateNumberedMockVideo({ output, durationSec: 4, ratio: "9:16", number: 42 });
      const media = await probeMedia(output);

      expect(generated).toEqual({ path: output, number: 42 });
      expect(media.streams.find((stream) => stream.codec_type === "video")).toMatchObject({
        codec_name: "h264",
        width: 720,
        height: 1280,
      });
      expect(media.streams.find((stream) => stream.codec_type === "audio")?.codec_name).toBe("aac");
      expect(Number(media.format.duration)).toBeWithin(3.9, 4.1);
      expect(await Bun.file(`${output}.number.ppm`).exists()).toBeFalse();
    },
    30_000,
  );

  run(
    "bypasses accounts, TOS and provider state through the shared Seedance boundary",
    async () => {
      env.mockGenerateVideoApi = true;
      const directory = await mkdtemp(resolve(tmpdir(), "seedance-worker-mock-"));
      directories.push(directory);
      const store = new SqliteJobStore(resolve(directory, "jobs.sqlite"));
      const job = createJob(crypto.randomUUID());
      store.create(job);

      const result = await new SeedanceVideoJob({
        store,
        change: (id, patch) => store.update(id, patch),
      }).execute(job, "doubao-seedance-2-0-fast-260128");
      const output = resolve(directory, "worker-result.mp4");
      await Bun.write(output, result.bytes);
      const media = await probeMedia(output);

      expect(result.executionMode).toBe("mock");
      expect(result.implementation).toBe("ffmpeg-seedance-mock");
      expect(Number(media.format.duration)).toBeWithin(6.9, 7.1);
      expect(store.get(job.id)?.providerTaskId).toBeUndefined();
      expect(store.get(job.id)?.providerStatus).toBeUndefined();
      expect(store.get(job.id)?.stagingKeys).toEqual([]);
      store.close();
    },
    30_000,
  );

  test("marks generic Seedance stages as explicit FFmpeg Mock", () => {
    env.mockGenerateVideoApi = true;
    const plan = buildExecutionPlan(
      "ai-generate",
      { type: "视频", creationKind: "video" },
      "doubao-seedance-2-0-fast-260128",
    );
    const videoStage = plan.find((stage) => stage.capability === "multimodal-generate");
    expect(videoStage).toMatchObject({
      executionMode: "mock",
      implementation: "ffmpeg-seedance-mock",
      provider: undefined,
      model: undefined,
    });
  });

  run(
    "persists generic Seedance output and provenance as Mock",
    async () => {
      env.mockGenerateVideoApi = true;
      const directory = await mkdtemp(resolve(tmpdir(), "seedance-generic-mock-"));
      directories.push(directory);
      const store = new SqliteJobStore(resolve(directory, "jobs.sqlite"));
      const job = createJob(crypto.randomUUID());
      store.create(job);
      generatedFiles.push(resolve(env.dataDir, "results", `${job.id}-multimodal-generate.mp4`));

      await new JobProcessor(store).process(job.id);
      const completed = store.get(job.id);

      expect(completed?.status).toBe("succeeded");
      expect(completed?.overallExecutionMode).toBe("mixed");
      const videoStage = completed?.provenance.find((stage) => stage.capability === "multimodal-generate");
      expect(videoStage).toMatchObject({
        executionMode: "mock",
        implementation: "ffmpeg-seedance-mock",
      });
      expect(videoStage?.provider).toBeUndefined();
      expect(videoStage?.model).toBeUndefined();
      expect(completed?.result?.artifacts.find((artifact) => artifact.mimeType === "video/mp4")?.executionMode).toBe(
        "mock",
      );
      expect(completed?.providerTaskId).toBeUndefined();
      expect(completed?.stagingKeys).toEqual([]);
      store.close();
    },
    30_000,
  );
});
