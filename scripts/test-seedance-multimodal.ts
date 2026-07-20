import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Worker } from "bullmq";
import { extractAudio, extractFrame, generateSampleVideo, probeMedia } from "../server/media/ffmpeg";
import { type SeedanceModelId, seedanceModelIds } from "../server/models/video-models";

const tempDir = await mkdtemp(resolve(tmpdir(), "yaozuo-seedance-matrix-"));
process.env.YAOZUO_DATA_DIR = tempDir;
process.env.ALLOW_MOCK_FALLBACK = "false";
process.env.FORCE_MOCK = "false";
await mkdir(resolve(tempDir, "results"), { recursive: true });
const capabilitySource = Bun.file(resolve(".data/capabilities.json"));
if (!(await capabilitySource.exists())) throw new Error("MODEL_CAPABILITY_REPORT_REQUIRED");
const capabilityReport = (await capabilitySource.json()) as {
  generatedAt?: string;
  runId?: string;
  entries?: Array<{ id: string; status: string; model?: string; provider?: string }>;
};
await Bun.write(
  resolve(tempDir, "capabilities.json"),
  `${JSON.stringify({ ...capabilityReport, entries: (capabilityReport.entries ?? []).filter((entry) => entry.id.startsWith("aihubmix-seedance-")) }, null, 2)}\n`,
);
const [{ accounts, app, queue, store }, { env }, { JobProcessor }, { createWorkerRedisConnection }] = await Promise.all(
  [import("../server/app"), import("../server/env"), import("../worker/job-processor"), import("../worker/redis")],
);
const processor = new JobProcessor(store, accounts);
const workerRedis = createWorkerRedisConnection();
const worker = new Worker<{ jobId: string }>(env.redisQueueName, (job) => processor.process(job.data.jobId), {
  connection: workerRedis,
  concurrency: 1,
});
await worker.waitUntilReady();

const outputDir = resolve("artifacts/api-tests/seedance-multimodal");
await mkdir(outputDir, { recursive: true });
const fixtureVideo = resolve(tempDir, "reference.mp4"),
  fixtureImage = resolve(tempDir, "reference.png"),
  fixtureAudio = resolve(tempDir, "reference.wav");
await generateSampleVideo(fixtureVideo);
await extractFrame(fixtureVideo, fixtureImage);
await extractAudio(fixtureVideo, fixtureAudio);
const request = (path: string, init: RequestInit = {}) => app.request(`http://${env.host}:${env.port}${path}`, init);
const password = "SeedanceMatrix12345";
const registration = await request("/api/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: `seedance-matrix-${Date.now()}@example.com`, password, displayName: "Seedance 实测" }),
});
if (registration.status !== 201) throw new Error(`REGISTER_${registration.status}:${await registration.text()}`);
const token = ((await registration.json()) as { token: string }).token;
const auth = { Authorization: `Bearer ${token}` };

async function upload(path: string, name: string, mimeType: string) {
  const form = new FormData();
  form.set("file", new File([Bun.file(path)], name, { type: mimeType }));
  const response = await request("/api/uploads", { method: "POST", headers: auth, body: form });
  if (response.status !== 201) throw new Error(`UPLOAD_${response.status}:${await response.text()}`);
  return ((await response.json()) as { asset: { id: string; name: string; mimeType: string } }).asset;
}
const image = await upload(fixtureImage, "reference.png", "image/png"),
  video = await upload(fixtureVideo, "reference.mp4", "video/mp4"),
  audio = await upload(fixtureAudio, "reference.wav", "audio/wav");

type Scenario = { id: "image-no-audio" | "video-audio"; assets: (typeof image)[]; generateAudio: boolean };
const scenarios: Scenario[] = [
  { id: "image-no-audio", assets: [image], generateAudio: false },
  { id: "video-audio", assets: [video, audio], generateAudio: true },
];
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7) as SeedanceModelId | undefined;
const models = only ? seedanceModelIds.filter((model) => model === only) : seedanceModelIds;
let evidence: Array<Record<string, unknown>> = [];
try {
  const previous = (await Bun.file(resolve(outputDir, "report.json")).json()) as {
    evidence?: Array<Record<string, unknown>>;
  };
  evidence = (previous.evidence ?? [])
    .filter((item) => !models.includes(item.model as SeedanceModelId))
    .map((item) =>
      item.status === "failed" && typeof item.error === "string" && item.error.startsWith("AUDIO_EXPECTED_")
        ? { ...item, status: "capability_deviation", deviations: [item.error] }
        : item,
    );
} catch {
  /* first matrix run */
}

try {
  for (const model of models)
    for (const scenario of scenarios) {
      const startedAt = new Date().toISOString();
      try {
        const values = {
          type: "视频",
          prompt: `Create a stable studio product shot for ${scenario.id}.`,
          ratio: "16:9",
          generateAudio: String(scenario.generateAudio),
          references: `assets:${JSON.stringify(scenario.assets)}`,
        };
        const response = await request("/api/ai-generate/jobs", {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({
            title: `${model}-${scenario.id}`,
            values,
            videoModel: model,
            allowMockFallback: false,
          }),
        });
        if (response.status !== 202) throw new Error(`CREATE_JOB_${response.status}:${await response.text()}`);
        let job = (await response.json()) as any;
        const deadline = Date.now() + 25 * 60_000;
        while (!["succeeded", "failed", "cancelled"].includes(job.status) && Date.now() < deadline) {
          await Bun.sleep(5_000);
          const status = await request(`/api/jobs/${job.id}`, { headers: auth });
          job = await status.json();
        }
        if (job.status !== "succeeded") throw new Error(`JOB_${job.status}:${JSON.stringify(job.error ?? {})}`);
        const artifact = job.result?.artifacts?.find((item: any) => item.mimeType?.startsWith("video/") && item.url);
        if (!artifact) throw new Error("VIDEO_ARTIFACT_MISSING");
        const artifactResponse = await request(artifact.url, { headers: auth });
        if (!artifactResponse.ok) throw new Error(`ARTIFACT_${artifactResponse.status}`);
        const path = resolve(outputDir, `${model}-${scenario.id}.mp4`);
        await Bun.write(path, new Uint8Array(await artifactResponse.arrayBuffer()));
        const media = await probeMedia(path);
        const videoStream = media.streams.find((stream) => stream.codec_type === "video"),
          audioStream = media.streams.find((stream) => stream.codec_type === "audio"),
          duration = Number(media.format.duration ?? 0);
        const deviations: string[] = [];
        if (videoStream?.width !== 1280 || videoStream.height !== 720)
          deviations.push(`DIMENSIONS_${videoStream?.width}x${videoStream?.height}`);
        if (Math.abs(duration - 5) > 1) deviations.push(`DURATION_${duration}`);
        if (Boolean(audioStream) !== scenario.generateAudio)
          deviations.push(`AUDIO_EXPECTED_${scenario.generateAudio}_GOT_${Boolean(audioStream)}`);
        evidence.push({
          model,
          scenario: scenario.id,
          status: deviations.length ? "capability_deviation" : "verified",
          deviations,
          startedAt,
          completedAt: new Date().toISOString(),
          providerTaskId: job.providerTaskId,
          request: {
            resolution: "720p",
            ratio: "16:9",
            duration: 5,
            generateAudio: scenario.generateAudio,
            references: scenario.assets.map((asset) => asset.mimeType.split("/")[0]),
          },
          result: {
            width: videoStream?.width,
            height: videoStream?.height,
            duration,
            videoCodec: videoStream?.codec_name,
            audioCodec: audioStream?.codec_name,
            hasAudio: Boolean(audioStream),
            bytes: Bun.file(path).size,
          },
          stagingCleaned: job.stagingKeys?.length === 0,
        });
      } catch (error) {
        evidence.push({
          model,
          scenario: scenario.id,
          status: "failed",
          startedAt,
          completedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message.slice(0, 1200) : String(error).slice(0, 1200),
        });
      }
      await Bun.write(
        resolve(outputDir, "report.json"),
        `${JSON.stringify({ generatedAt: new Date().toISOString(), bucket: env.tos.bucket, region: env.tos.region, evidence }, null, 2)}\n`,
      );
    }
} finally {
  await worker.close();
  await workerRedis.quit();
  await queue.close();
  await rm(tempDir, { recursive: true, force: true });
}

console.log(
  JSON.stringify(
    {
      attempted: evidence.length,
      verified: evidence.filter((item) => item.status === "verified").length,
      deviations: evidence.filter((item) => item.status === "capability_deviation").length,
      failed: evidence.filter((item) => item.status === "failed").length,
    },
    null,
    2,
  ),
);
if (evidence.some((item) => item.status !== "verified")) process.exitCode = 1;
