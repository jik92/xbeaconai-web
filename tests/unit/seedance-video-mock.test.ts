import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SqliteJobStore } from "../../server/jobs/sqlite-job-store";
import {
  generateNumberedMockVideo,
  mockVideoDimensions,
  probeMedia,
  randomTwoDigitNumber,
} from "../../server/media/ffmpeg";
import { arkSeedance } from "../../server/providers/ark-seedance";
import type { JobRecord } from "../../server/types";
import {
  assertSeedanceDuration,
  assertSeedanceImageReference,
  assertSeedanceReferenceVideoDuration,
  buildVirtualPortraitFallbackPrompt,
  isArkRealPersonPrivacyError,
  SeedanceFlowError,
  SeedanceVideoJob,
  seedanceVideoSettings,
} from "../../worker/jobs/job-seedance-video";

const directories: string[] = [];
const originalMockGenerateVideoApi = process.env.MOCK_GENERATE_VIDEO_API;

describe("Seedance virtual portrait privacy fallback", () => {
  test("matches only the explicit Ark real-person privacy rejection", () => {
    expect(
      isArkRealPersonPrivacyError(
        new Error(
          'ARK_400: {"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation","message":"input may contain real person"}}',
        ),
      ),
    ).toBe(true);
    expect(isArkRealPersonPrivacyError(new Error("ARK_400: invalid ratio"))).toBe(false);
    expect(isArkRealPersonPrivacyError(new Error("ARK_429: may contain real person"))).toBe(false);
  });

  test("locks every source-image detail except facial identity", () => {
    const selected = buildVirtualPortraitFallbackPrompt(true);
    expect(selected).toContain("Preserve the product exactly");
    expect(selected).toContain("Preserve the person's body, clothing, pose, hands, action");
    expect(selected).toContain("smooth, featureless, matte neutral tracking placeholder");
    expect(selected).toContain("separate registered virtual portrait");
    expect(buildVirtualPortraitFallbackPrompt(false)).toContain("default virtual portrait");
  });
});

afterEach(async () => {
  if (originalMockGenerateVideoApi === undefined) delete process.env.MOCK_GENERATE_VIDEO_API;
  else process.env.MOCK_GENERATE_VIDEO_API = originalMockGenerateVideoApi;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
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

  test("accepts one-second drift and rejects invalid or truncated duration evidence", () => {
    expect(assertSeedanceDuration(15, 14, "上游终态")).toBe(14);
    expect(() => assertSeedanceDuration(15, 13.99, "上游终态")).toThrow(SeedanceFlowError);
    expect(() => assertSeedanceDuration(15, Number.NaN, "下载视频")).toThrow("未返回有效的视频时长");
  });

  test("rejects reference videos longer than the Ark Seedance limit before submission", () => {
    expect(assertSeedanceReferenceVideoDuration(15.2)).toBe(15.2);
    expect(() => assertSeedanceReferenceVideoDuration(15.21)).toThrow("参考视频时长不能超过 15.2 秒");
  });

  test("requires an image among prepared Seedance 2 references", () => {
    expect(() => assertSeedanceImageReference([])).toThrow("必须提供至少一张图片参考");
    expect(() => assertSeedanceImageReference([{ kind: "video", url: "https://example.test/reference.mp4" }])).toThrow(
      SeedanceFlowError,
    );
    expect(
      assertSeedanceImageReference([{ kind: "image", url: "https://example.test/reference.jpg" }]),
    ).toBeUndefined();
  });

  test("rejects an in-flight task created by the removed AIHubMix video provider", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "seedance-legacy-provider-"));
    directories.push(directory);
    const store = new SqliteJobStore(resolve(directory, "jobs.sqlite"));
    const job = {
      ...createJob(crypto.randomUUID()),
      values: { duration: "15", ratio: "16:9", prompt: "十五秒测试视频" },
      providerTaskId: "provider-task",
      providerStatus: "processing",
      providerDeadlineAt: new Date(Date.now() + 60_000).toISOString(),
      executionPlan: [
        {
          id: "legacy-video",
          capability: "video-generate",
          executionMode: "real" as const,
          implementation: "aihubmix-video",
          provider: "aihubmix",
          model: "doubao-seedance-2-0-mini-260615",
          startedAt: new Date().toISOString(),
        },
      ],
    };
    store.create(job);
    try {
      await expect(
        new SeedanceVideoJob({ store, change: (id, patch) => store.update(id, patch) }).execute(
          job,
          "doubao-seedance-2-0-mini-260615",
        ),
      ).rejects.toMatchObject({ code: "LEGACY_VIDEO_PROVIDER_TASK_UNSUPPORTED", retryable: false });
    } finally {
      store.close();
    }
  });

  const run = Bun.which("ffmpeg") && Bun.which("ffprobe") ? test : test.skip;
  run(
    "rejects a downloaded video whose probed duration differs from the request",
    async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "seedance-file-duration-"));
      directories.push(directory);
      const source = resolve(directory, "five-seconds.mp4");
      await generateNumberedMockVideo({ output: source, durationSec: 5, ratio: "16:9" });
      const store = new SqliteJobStore(resolve(directory, "jobs.sqlite"));
      const job = {
        ...createJob(crypto.randomUUID()),
        values: { duration: "15", ratio: "16:9", prompt: "十五秒测试视频" },
        providerTaskId: "provider-task",
        providerStatus: "processing",
        providerDeadlineAt: new Date(Date.now() + 60_000).toISOString(),
      };
      store.create(job);
      const originalGetVideo = arkSeedance.getVideo;
      const originalDownloadVideo = arkSeedance.downloadVideo;
      arkSeedance.getVideo = async () => ({
        id: "provider-task",
        status: "succeeded",
        content: { video_url: "https://example.test/video.mp4" },
      });
      arkSeedance.downloadVideo = async () => ({
        bytes: new Uint8Array(await Bun.file(source).arrayBuffer()),
        mimeType: "video/mp4",
      });
      try {
        await expect(
          new SeedanceVideoJob({ store, change: (id, patch) => store.update(id, patch) }).execute(
            job,
            "doubao-seedance-2-0-mini-260615",
          ),
        ).rejects.toMatchObject({ code: "VIDEO_DURATION_MISMATCH", retryable: true });
      } finally {
        arkSeedance.getVideo = originalGetVideo;
        arkSeedance.downloadVideo = originalDownloadVideo;
        store.close();
      }
    },
    30_000,
  );

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

  test("ignores the removed Mock environment flag and enters the real Ark flow", async () => {
    process.env.MOCK_GENERATE_VIDEO_API = "true";
    const directory = await mkdtemp(resolve(tmpdir(), "seedance-real-only-"));
    directories.push(directory);
    const store = new SqliteJobStore(resolve(directory, "jobs.sqlite"));
    const job = createJob(crypto.randomUUID());
    store.create(job);

    try {
      await expect(
        new SeedanceVideoJob({
          store,
          change: (id, patch) => store.update(id, patch),
        }).execute(job, "doubao-seedance-2-0-fast-260128"),
      ).rejects.toMatchObject({ code: "ACCOUNT_STORE_UNAVAILABLE", retryable: false });
    } finally {
      store.close();
    }
  });
});
