import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { probeMedia } from "../server/media/ffmpeg";
import { isSeedanceModelId, seedanceModelIds } from "../server/models/video-models";
import { aihubmix } from "../server/providers/aihubmix";
import { arkSeedance } from "../server/providers/ark-seedance";
import { auditSdkRegistry } from "../server/sdk-registry";
import { APP_CONFIG } from "../web/app/config";

type Status = "verified" | "unauthorized" | "unsupported" | "failed";
interface Evidence {
  id: string;
  capability: string;
  provider?: string;
  model?: string;
  status: Status;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  result?: Record<string, unknown>;
  error?: string;
}

const outputDir = resolve("artifacts/api-tests/models");
await mkdir(outputDir, { recursive: true });
const cachePath = resolve(outputDir, "evidence-cache.json");
let cache: Record<string, Evidence> = {};
try {
  cache = JSON.parse(await Bun.file(cachePath).text()) as Record<string, Evidence>;
} catch {
  /* first run */
}
try {
  const previous = JSON.parse(await Bun.file(resolve(outputDir, "report.json")).text()) as { evidence?: Evidence[] };
  for (const item of previous.evidence ?? []) cache[item.id] = item;
} catch {
  /* first run */
}
const decodeBase64 = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};
const entries = auditSdkRegistry().filter((entry) => entry.kind === "model");
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7);
const selected = only ? entries.filter((entry) => entry.capability === only || entry.id === only) : entries;
const evidence: Evidence[] = [];
const reuseVerified = process.argv.includes("--reuse-verified");
const catalogStartedAt = new Date().toISOString();
const liveCatalog = await arkSeedance.listModels();
const catalogEvidence = seedanceModelIds.map((model) => {
  const item = liveCatalog.find((candidate) => candidate.id === model);
  return { model, present: Boolean(item) };
});
if (catalogEvidence.some((item) => !item.present))
  throw new Error(
    `SEEDANCE_MODEL_MISSING:${catalogEvidence
      .filter((item) => !item.present)
      .map((item) => item.model)
      .join(",")}`,
  );

for (const entry of selected) {
  if (reuseVerified && cache[entry.id]?.status === "verified") {
    evidence.push(cache[entry.id]);
    continue;
  }
  const started = Date.now();
  const startedAt = new Date().toISOString();
  try {
    let result: Record<string, unknown>;
    if (entry.capability === "text-generate") {
      const response = await aihubmix.generateText(`只回复：${APP_CONFIG.projectName}接口测试成功`, entry.model);
      result = { characters: response.text.length, model: response.model, nonEmpty: Boolean(response.text.trim()) };
    } else if (entry.capability === "image-generate") {
      const response = await aihubmix.generateImage(
        "A simple orange circle centered on a clean white background, flat icon",
        entry.model,
      );
      const bytes = response.b64_json
        ? decodeBase64(response.b64_json)
        : response.url
          ? await fetch(response.url).then((item) => item.bytes())
          : (() => {
              throw new Error("IMAGE_RESULT_URL_MISSING");
            })();
      const path = resolve(outputDir, `${entry.id}.png`);
      await Bun.write(path, bytes);
      const media = await probeMedia(path);
      result = { bytes: bytes.byteLength, width: media.streams[0]?.width, height: media.streams[0]?.height };
    } else if (entry.capability === "audio-generate") {
      const response = await aihubmix.synthesizeSpeech(`${APP_CONFIG.projectName}音频接口测试成功。`, entry.model);
      const path = resolve(outputDir, `${entry.id}.wav`);
      await Bun.write(path, response.bytes);
      const media = await probeMedia(path);
      result = {
        bytes: response.bytes.byteLength,
        duration: media.format.duration,
        codec: media.streams[0]?.codec_name,
      };
    } else if (entry.capability === "video-generate") {
      if (!isSeedanceModelId(entry.model)) throw new Error(`INVALID_VIDEO_MODEL:${entry.model}`);
      const requestedDuration = entry.model === "doubao-seedance-2-0-mini-260615" ? (15 as const) : (5 as const);
      const request = {
        model: entry.model,
        prompt: "A single orange ball slowly rolls across a clean white studio floor, static camera",
        resolution: "720p" as const,
        ratio: "16:9" as const,
        duration: requestedDuration,
        generateAudio: true,
        watermark: false,
        references: [],
      };
      const created = await arkSeedance.createVideo(request);
      const completed = await arkSeedance.waitForVideo(created.id);
      const videoUrl = completed.content?.video_url;
      if (!videoUrl) throw new Error("ARK_VIDEO_URL_MISSING");
      const response = await arkSeedance.downloadVideo(videoUrl);
      const path = resolve(outputDir, `${entry.id}.mp4`);
      await Bun.write(path, response.bytes);
      const media = await probeMedia(path);
      const video = media.streams.find((stream) => stream.codec_type === "video"),
        audio = media.streams.find((stream) => stream.codec_type === "audio"),
        duration = Number(media.format.duration ?? video?.duration ?? 0);
      if (video?.width !== 1280 || video.height !== 720)
        throw new Error(`VIDEO_DIMENSIONS_MISMATCH:${video?.width}x${video?.height}`);
      if (Math.abs(duration - requestedDuration) > 1) throw new Error(`VIDEO_DURATION_MISMATCH:${duration}`);
      if (!audio) throw new Error("VIDEO_AUDIO_STREAM_MISSING");
      result = {
        bytes: response.bytes.byteLength,
        duration,
        videoCodec: video.codec_name,
        audioCodec: audio.codec_name,
        width: video.width,
        height: video.height,
        acceptedRequest: {
          resolution: request.resolution,
          ratio: request.ratio,
          duration: request.duration,
          generateAudio: request.generateAudio,
          watermark: request.watermark,
          references: [],
        },
        providerTaskId: completed.id,
      };
    } else throw new Error(`No test adapter for ${entry.capability}`);
    evidence.push({
      id: entry.id,
      capability: entry.capability,
      provider: entry.provider,
      model: entry.model,
      status: "verified",
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status: Status = /401|403|AUTH/.test(message)
      ? "unauthorized"
      : /404|NOT_CONFIGURED|MODEL_NOT_AVAILABLE/.test(message)
        ? "unsupported"
        : "failed";
    evidence.push({
      id: entry.id,
      capability: entry.capability,
      provider: entry.provider,
      model: entry.model,
      status,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      error: message.slice(0, 1200),
    });
  }
}

for (const item of evidence) cache[item.id] = item;
await Bun.write(cachePath, `${JSON.stringify(cache, null, 2)}\n`);

const report = {
  runId: crypto.randomUUID(),
  kind: "model",
  generatedAt: new Date().toISOString(),
  catalog: { checkedAt: catalogStartedAt, models: catalogEvidence },
  registered: selected.length,
  attempted: evidence.length,
  reported: evidence.length,
  evidence,
};
if (!(report.registered === report.attempted && report.attempted === report.reported))
  throw new Error("Model SDK registry coverage mismatch");
await Bun.write(resolve(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
await mkdir(resolve(".data"), { recursive: true });
let retainedCapabilities: Array<{ id: string; status: string; model?: string; provider?: string }> = [];
if (only)
  try {
    const previous = (await Bun.file(resolve(".data/capabilities.json")).json()) as {
      entries?: typeof retainedCapabilities;
    };
    const replacedIds = new Set(evidence.map((item) => item.id));
    retainedCapabilities = (previous.entries ?? []).filter(
      (item) => !replacedIds.has(item.id) && !item.id.startsWith("aihubmix-seedance-"),
    );
  } catch {
    /* first partial capability run */
  }
await Bun.write(
  resolve(".data/capabilities.json"),
  `${JSON.stringify(
    {
      generatedAt: report.generatedAt,
      runId: report.runId,
      entries: [
        ...retainedCapabilities,
        ...evidence.map((item) => ({ id: item.id, status: item.status, model: item.model, provider: item.provider })),
      ],
    },
    null,
    2,
  )}\n`,
);
console.log(JSON.stringify(report, null, 2));
