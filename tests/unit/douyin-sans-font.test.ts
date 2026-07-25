import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  burnSubtitleFile,
  DOUYIN_SANS_FONT_NAME,
  DOUYIN_SANS_FONT_PATH,
  generateSampleVideo,
  probeMedia,
} from "../../server/media/ffmpeg";

const expectedFontSha256 = "fbecfacdfac33982774e301073a8d357a09c698cd3134bb6ddec0f5bfc268fa1";
const fontLicensePath = resolve(import.meta.dir, "../../assets/fonts/douyin-sans/OFL.txt");

describe("Douyin Sans subtitle font", () => {
  test("bundles the unmodified official font and its license", async () => {
    const font = Bun.file(DOUYIN_SANS_FONT_PATH);
    const license = Bun.file(fontLicensePath);

    expect(await font.exists()).toBe(true);
    expect(await license.exists()).toBe(true);
    expect(DOUYIN_SANS_FONT_NAME).toBe("DouyinSans");

    const hash = new Bun.CryptoHasher("sha256").update(await font.arrayBuffer()).digest("hex");
    expect(hash).toBe(expectedFontSha256);
    expect(await license.text()).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });

  test("burns Chinese subtitles through the bundled font directory", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "douyin-sans-subtitle-test-"));
    const input = join(directory, "input.mp4");
    const subtitle = join(directory, "subtitle.srt");
    const output = join(directory, "output.mp4");

    try {
      await generateSampleVideo(input, 1);
      await Bun.write(subtitle, "1\n00:00:00,000 --> 00:00:00,900\n抖音美好体字幕测试\n");
      await burnSubtitleFile(input, subtitle, output);

      expect(await Bun.file(output).exists()).toBe(true);
      const media = await probeMedia(output);
      expect(media.streams.some((stream) => stream.codec_type === "video")).toBe(true);
      expect(Number(media.format.duration)).toBeGreaterThanOrEqual(0.9);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
