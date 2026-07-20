import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { extractCompressedAudio, probeMedia } from "../server/media/ffmpeg";
import { analyzeVideoWithGemini, transcribeMediaWithAihubmix } from "../server/providers/gemini-video-analysis";
import { buildVideoAnalysisPrompt } from "../web/features/video-remix/video-analysis-prompt";

const videoPath = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("用法：bun scripts/test-video-analysis.ts <video-path> [model]");
const media = await probeMedia(videoPath);
const durationSeconds = Number(media.format.duration ?? 0);
const startedAt = new Date().toISOString();
const outputDir = resolve("artifacts/api-tests/video-analysis");
await mkdir(outputDir, { recursive: true });
const slug = basename(videoPath).replace(/\.[^.]+$/, "");
const reportPath = resolve(outputDir, `${slug}.report.json`);
console.error(`[video-analysis] probing complete: ${durationSeconds.toFixed(2)}s`);
let transcription: Awaited<ReturnType<typeof transcribeMediaWithAihubmix>>;
let cachedTranscript = "";
if (!process.argv.includes("--refresh-transcript")) {
  try {
    const cached = (await Bun.file(reportPath).json()) as { transcript?: string };
    cachedTranscript = cached.transcript?.trim() ?? "";
  } catch {
    // First analysis of this video requires live transcription.
  }
}
if (cachedTranscript) {
  transcription = { text: cachedTranscript, usage: { cached: true } };
  console.error(`[video-analysis] reusing verified transcript: ${cachedTranscript.length} chars`);
} else {
  const tempDir = await mkdtemp(resolve(tmpdir(), "yaozuo-video-analysis-"));
  try {
    const audioPath = resolve(tempDir, "source.mp3");
    await extractCompressedAudio(videoPath, audioPath);
    console.error("[video-analysis] transcribing audio");
    transcription = await transcribeMediaWithAihubmix({ mediaPath: audioPath, mimeType: "audio/mpeg" });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
console.error(`[video-analysis] transcription complete: ${transcription.text.length} chars`);
const prompt = buildVideoAnalysisPrompt({ durationSeconds, speechTranscript: transcription.text });
console.error(`[video-analysis] analyzing video with ${process.argv[3] ?? "gemini-3.1-pro-preview"}`);
const result = await analyzeVideoWithGemini({ videoPath, prompt, model: process.argv[3] });
console.error(`[video-analysis] model response complete: ${result.text.length} chars`);
await Bun.write(resolve(outputDir, `${slug}.prompt.txt`), `${prompt}\n`);
await Bun.write(resolve(outputDir, `${slug}.result.md`), `${result.text}\n`);
await Bun.write(
  reportPath,
  `${JSON.stringify(
    {
      startedAt,
      completedAt: new Date().toISOString(),
      videoPath,
      durationSeconds,
      model: result.model,
      transcript: transcription.text,
      transcriptionUsage: transcription.usage,
      usage: result.usage,
      promptCharacters: prompt.length,
      resultCharacters: result.text.length,
    },
    null,
    2,
  )}\n`,
);
console.log(result.text);
