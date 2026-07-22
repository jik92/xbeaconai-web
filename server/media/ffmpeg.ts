import { mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";

async function run(binary: "ffmpeg" | "ffprobe", args: string[]) {
  const process = Bun.spawn([binary, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${binary} exited ${exitCode}: ${stderr.slice(-2000)}`);
  return { stdout, stderr };
}

async function outputDir(path: string) {
  await mkdir(dirname(path), { recursive: true });
}

let ffmpegFiltersPromise: Promise<string> | undefined;
async function requireFfmpegFilter(filter: string) {
  ffmpegFiltersPromise ??= run("ffmpeg", ["-hide_banner", "-filters"]).then(({ stdout }) => stdout);
  const filters = await ffmpegFiltersPromise;
  if (!new RegExp(`\\b${filter}\\b`).test(filters))
    throw new Error(`FFMPEG_FILTER_UNAVAILABLE:${filter}:请安装启用 libass 的 FFmpeg`);
}

export async function generateSampleVideo(output: string) {
  await outputDir(output);
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    output,
  ]);
  return output;
}

export async function generateSampleAudio(output: string, durationSec = 4) {
  await outputDir(output);
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    String(durationSec),
    "-c:a",
    "pcm_s16le",
    output,
  ]);
  return output;
}

export type MockVideoRatio = "16:9" | "9:16" | "1:1";

export function mockVideoDimensions(ratio: MockVideoRatio, resolution: "480p" | "720p" = "720p") {
  if (resolution === "480p") {
    if (ratio === "9:16") return { width: 480, height: 854 };
    if (ratio === "1:1") return { width: 480, height: 480 };
    return { width: 854, height: 480 };
  }
  if (ratio === "9:16") return { width: 720, height: 1280 };
  if (ratio === "1:1") return { width: 720, height: 720 };
  return { width: 1280, height: 720 };
}

export function randomTwoDigitNumber() {
  const [value = 0] = crypto.getRandomValues(new Uint32Array(1));
  return 10 + (value % 90);
}

function numberedOverlay(number: number) {
  const glyphs: Record<string, string[]> = {
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
    "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  };
  const label = String(number);
  const scale = 18;
  const padding = 18;
  const glyphWidth = 5 * scale;
  const gap = scale;
  const width = padding * 2 + label.length * glyphWidth + (label.length - 1) * gap;
  const height = padding * 2 + 7 * scale;
  const pixels: string[] = ["P3", `${width} ${height}`, "255"];
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const localX = x - padding;
      const localY = y - padding;
      const slotWidth = glyphWidth + gap;
      const charIndex = Math.floor(localX / slotWidth);
      const glyphX = Math.floor((localX % slotWidth) / scale);
      const glyphY = Math.floor(localY / scale);
      const on =
        localX >= 0 &&
        localY >= 0 &&
        charIndex >= 0 &&
        charIndex < label.length &&
        glyphX >= 0 &&
        glyphX < 5 &&
        glyphY >= 0 &&
        glyphY < 7 &&
        glyphs[label[charIndex]]?.[glyphY]?.[glyphX] === "1";
      pixels.push(on ? "255 255 255" : "0 0 0");
    }
  return `${pixels.join("\n")}\n`;
}

export async function generateNumberedMockVideo(input: {
  output: string;
  durationSec: number;
  ratio: MockVideoRatio;
  resolution?: "480p" | "720p";
  number?: number;
}) {
  if (!Number.isFinite(input.durationSec) || input.durationSec <= 0) throw new Error("MOCK_VIDEO_DURATION_INVALID");
  const number = input.number ?? randomTwoDigitNumber();
  if (!Number.isInteger(number) || number < 10 || number > 99) throw new Error("MOCK_VIDEO_NUMBER_INVALID");
  await outputDir(input.output);
  const overlay = `${input.output}.number.ppm`;
  const { width, height } = mockVideoDimensions(input.ratio, input.resolution);
  await Bun.write(overlay, numberedOverlay(number));
  try {
    await run("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=black:s=${width}x${height}:r=24:d=${input.durationSec}`,
      "-loop",
      "1",
      "-framerate",
      "24",
      "-i",
      overlay,
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-filter_complex",
      "[0:v][1:v]overlay=(W-w)/2:(H-h)/2:shortest=1[v]",
      "-map",
      "[v]",
      "-map",
      "2:a:0",
      "-t",
      String(input.durationSec),
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      "-movflags",
      "+faststart",
      "-shortest",
      input.output,
    ]);
  } finally {
    await unlink(overlay).catch(() => undefined);
  }
  return { path: input.output, number };
}

export async function probeMedia(input: string) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", input]);
  return JSON.parse(stdout) as {
    streams: Array<{
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      duration?: string;
      sample_rate?: string;
      channels?: number;
    }>;
    format: { duration?: string; size?: string; format_name?: string };
  };
}

export async function transcodeVideo(input: string, output: string) {
  await outputDir(output);
  await run("ffmpeg", [
    "-y",
    "-i",
    input,
    "-vf",
    "scale=480:-2",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    output,
  ]);
  return output;
}

export async function extractFrame(input: string, output: string) {
  await outputDir(output);
  await run("ffmpeg", ["-y", "-ss", "1", "-i", input, "-frames:v", "1", output]);
  return output;
}

export async function extractAudio(input: string, output: string) {
  await outputDir(output);
  await run("ffmpeg", ["-y", "-i", input, "-vn", "-c:a", "pcm_s16le", output]);
  return output;
}

export async function extractCompressedAudio(input: string, output: string) {
  await outputDir(output);
  await run("ffmpeg", ["-y", "-i", input, "-vn", "-c:a", "libmp3lame", "-b:a", "128k", output]);
  return output;
}

export async function normalizeReferenceImage(input: string, output: string) {
  await outputDir(output);
  await run("ffmpeg", [
    "-y",
    "-i",
    input,
    "-vf",
    "scale=1600:-2:force_original_aspect_ratio=decrease",
    "-frames:v",
    "1",
    "-q:v",
    "3",
    output,
  ]);
  return output;
}

export async function splitFixed(input: string, pattern: string) {
  await outputDir(pattern);
  await run("ffmpeg", [
    "-y",
    "-i",
    input,
    "-c",
    "copy",
    "-f",
    "segment",
    "-segment_time",
    "1",
    "-reset_timestamps",
    "1",
    pattern,
  ]);
  return pattern;
}

export async function concatVideos(inputs: string[], output: string) {
  if (inputs.length < 2) throw new Error("至少需要两个视频片段才能合并");
  await outputDir(output);
  const manifest = `${output}.concat.txt`;
  const escapePath = (path: string) => path.replaceAll("'", "'\\''");
  await Bun.write(manifest, inputs.map((path) => `file '${escapePath(path)}'`).join("\n"));
  try {
    await run("ffmpeg", [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      manifest,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      output,
    ]);
  } finally {
    await unlink(manifest).catch(() => undefined);
  }
  return output;
}

export async function normalizeMashupVideo(input: {
  source: string;
  output: string;
  width: number;
  height: number;
  hasAudio: boolean;
}) {
  await outputDir(input.output);
  const args = ["-y", "-i", input.source];
  if (!input.hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  args.push(
    "-map",
    "0:v:0",
    "-map",
    input.hasAudio ? "0:a:0" : "1:a:0",
    "-vf",
    `scale=${input.width}:${input.height}:force_original_aspect_ratio=decrease,pad=${input.width}:${input.height}:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-shortest",
    "-movflags",
    "+faststart",
    input.output,
  );
  await run("ffmpeg", args);
  return input.output;
}

export async function concatMashupVideos(inputs: string[], output: string) {
  if (inputs.length < 2) throw new Error("混剪至少需要两个视频片段");
  await outputDir(output);
  const args = ["-y"];
  for (const input of inputs) args.push("-i", input);
  const filters: string[] = [];
  const concatInputs: string[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    filters.push(`[${index}:v]setpts=PTS-STARTPTS[v${index}]`);
    filters.push(
      index === 0
        ? `[${index}:a]asetpts=PTS-STARTPTS[a${index}]`
        : `[${index}:a]volume=0,asetpts=PTS-STARTPTS[a${index}]`,
    );
    concatInputs.push(`[v${index}][a${index}]`);
  }
  filters.push(`${concatInputs.join("")}concat=n=${inputs.length}:v=1:a=1[v][a]`);
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    output,
  );
  await run("ffmpeg", args);
  return output;
}

export async function composeMedia(video: string, audio: string, output: string) {
  await outputDir(output);
  await run("ffmpeg", [
    "-y",
    "-i",
    video,
    "-i",
    audio,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    output,
  ]);
  return output;
}

export async function burnSubtitleFile(input: string, subtitleFile: string, output: string) {
  await requireFfmpegFilter("subtitles");
  await outputDir(output);
  const escapedSubtitleFile = subtitleFile.replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "\\'");
  await run("ffmpeg", [
    "-y",
    "-i",
    input,
    "-vf",
    `subtitles=filename='${escapedSubtitleFile}':force_style='FontName=Noto Sans CJK SC,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=36'`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    output,
  ]);
  return output;
}

export async function burnSubtitle(input: string, output: string) {
  await outputDir(output);
  const overlay = `${output}.ppm`;
  const glyphs: Record<string, string[]> = {
    Y: ["10001", "01010", "00100", "00100", "00100", "00100", "00100"],
    A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  };
  const label = "YAOZUO MOCK",
    scale = 6,
    width = label.length * 6 * scale + 24,
    height = 7 * scale + 18;
  const pixels: string[] = ["P3", `${width} ${height}`, "255"];
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const localX = x - 12,
        localY = y - 9,
        charIndex = Math.floor(localX / (6 * scale)),
        glyphX = Math.floor((localX % (6 * scale)) / scale),
        glyphY = Math.floor(localY / scale);
      const on =
        charIndex >= 0 &&
        charIndex < label.length &&
        glyphX >= 0 &&
        glyphX < 5 &&
        glyphY >= 0 &&
        glyphY < 7 &&
        glyphs[label[charIndex]]?.[glyphY]?.[glyphX] === "1";
      pixels.push(on ? "255 255 255" : "0 0 0");
    }
  await Bun.write(overlay, `${pixels.join("\n")}\n`);
  await run("ffmpeg", [
    "-y",
    "-i",
    input,
    "-loop",
    "1",
    "-i",
    overlay,
    "-filter_complex",
    "[0:v][1:v]overlay=(W-w)/2:H-h-20:shortest=1",
    "-c:v",
    "libx264",
    "-c:a",
    "copy",
    "-shortest",
    output,
  ]);
  return output;
}

export async function denoiseVideo(input: string, output: string) {
  await outputDir(output);
  await run("ffmpeg", ["-y", "-i", input, "-vf", "hqdn3d=1.5:1.5:6:6", "-c:v", "libx264", "-c:a", "copy", output]);
  return output;
}

export async function ffmpegVersion() {
  return (await run("ffmpeg", ["-version"])).stdout.split("\n")[0] ?? "unknown";
}
