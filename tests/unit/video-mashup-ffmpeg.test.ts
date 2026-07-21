import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { concatMashupVideos, generateSampleVideo, normalizeMashupVideo, probeMedia } from "../../server/media/ffmpeg";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("video mashup ffmpeg pipeline", () => {
  const run = Bun.which("ffmpeg") && Bun.which("ffprobe") ? test : test.skip;
  run(
    "normalizes and concatenates videos with stable video and audio streams",
    async () => {
      const directory = await mkdtemp(resolve(tmpdir(), "video-mashup-test-"));
      directories.push(directory);
      const first = await generateSampleVideo(resolve(directory, "first.mp4"));
      const second = await generateSampleVideo(resolve(directory, "second.mp4"));
      const normalizedFirst = resolve(directory, "normalized-first.mp4");
      const normalizedSecond = resolve(directory, "normalized-second.mp4");
      await normalizeMashupVideo({ source: first, output: normalizedFirst, width: 640, height: 360, hasAudio: true });
      await normalizeMashupVideo({ source: second, output: normalizedSecond, width: 640, height: 360, hasAudio: true });
      const output = await concatMashupVideos([normalizedFirst, normalizedSecond], resolve(directory, "output.mp4"));
      const media = await probeMedia(output);
      expect(media.streams.some((stream) => stream.codec_type === "video")).toBeTrue();
      expect(media.streams.some((stream) => stream.codec_type === "audio")).toBeTrue();
      expect(Number(media.format.duration)).toBeGreaterThan(7.5);
    },
    30_000,
  );
});
