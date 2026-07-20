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
