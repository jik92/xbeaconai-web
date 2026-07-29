import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { env } from "../server/env";
import { arkMediaUnderstanding } from "../server/providers/ark-media-understanding";
import { ossutils } from "../server/storage/ossutils";
import { mediaUnderstandModelIds, mediaUnderstandModels, stripJsonFence } from "../shared/media-understand/contract";

type Modality = "image" | "video" | "audio";

const selectedModel = process.argv.find((item) => item.startsWith("--model="))?.slice("--model=".length);
const models = selectedModel
  ? mediaUnderstandModelIds.filter((model) => model === selectedModel)
  : [...mediaUnderstandModelIds];
if (!models.length) throw new Error(`未知素材理解模型：${selectedModel}`);
if (!arkMediaUnderstanding.configured) throw new Error("ARK_API_KEY 未配置");
if (!ossutils.configured) throw new Error("TOS 未配置");

const testDir = await mkdtemp(resolve(tmpdir(), "yaozuo-ark-understanding-"));
const testPrefix = `diagnostics/media-understand/${crypto.randomUUID()}`;
const uploadedKeys: string[] = [];
const uploadedArkFileIds: string[] = [];

async function ffmpeg(args: string[]) {
  const child = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(`FFMPEG_FAILED: ${stderr.slice(0, 500)}`);
}

async function createFixtures() {
  const image = resolve(testDir, "red.png");
  const audio = resolve(testDir, "tone.wav");
  const video = resolve(testDir, "red-tone.mp4");
  await ffmpeg(["-f", "lavfi", "-i", "color=c=red:s=160x120", "-frames:v", "1", image]);
  await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=880:duration=1", "-c:a", "pcm_s16le", audio]);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=160x120:d=1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:duration=1",
    "-shortest",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    video,
  ]);
  return {
    image: { path: image, mimeType: "image/png", extension: "png" },
    video: { path: video, mimeType: "video/mp4", extension: "mp4" },
    audio: { path: audio, mimeType: "audio/wav", extension: "wav" },
  };
}

async function publishFixture(modality: Modality, fixture: { path: string; mimeType: string; extension: string }) {
  const key = `${testPrefix}/${modality}.${fixture.extension}`;
  const bytes = new Uint8Array(await Bun.file(fixture.path).arrayBuffer());
  await ossutils.putLibraryBytes({ bytes, key, mimeType: fixture.mimeType });
  uploadedKeys.push(key);
  const url = `${env.publicMedia.baseUrl.replace(/\/+$/, "")}/${key}`;
  const anonymousResponse = await fetch(url, {
    headers: { Range: "bytes=0-0" },
    signal: AbortSignal.timeout(20_000),
  });
  const response = await fetch(url, {
    headers: { Range: "bytes=0-0", Referer: "https://app.xbeaconai.com/" },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status !== 206) throw new Error(`MEDIA_CDN_RANGE_FAILED:${modality}:HTTP_${response.status}`);
  console.log(
    JSON.stringify({
      modality,
      cdnStatus: "passed",
      anonymousStatus: anonymousResponse.status,
      refererStatus: response.status,
    }),
  );
  return url;
}

function prompt(modality: Modality) {
  return `判断输入的${modality === "image" ? "图片" : modality === "video" ? "视频画面与声音" : "音频"}内容。
只返回 JSON 对象：{"modality":"${modality}","description":"你实际观察或听到的内容"}。`;
}

try {
  const fixtures = await createFixtures();
  await Promise.all([
    publishFixture("image", fixtures.image),
    publishFixture("video", fixtures.video),
    publishFixture("audio", fixtures.audio),
  ]);
  const sdkFileIds = {} as Record<Modality, string>;
  for (const modality of ["image", "video", "audio"] as const) {
    const fixture = fixtures[modality];
    const fileId = await arkMediaUnderstanding.uploadMedia(
      new File([Bun.file(fixture.path)], `${modality}.${fixture.extension}`, {
        type: fixture.mimeType,
      }),
    );
    sdkFileIds[modality] = fileId;
    uploadedArkFileIds.push(fileId);
  }
  const results: Array<{
    model: string;
    modality: Modality;
    ok: boolean;
    responseId?: string;
    error?: string;
  }> = [];
  for (const model of models) {
    for (const modality of ["image", "video", "audio"] as const) {
      const expectedSupported = mediaUnderstandModels
        .find((item) => item.id === model)
        ?.acceptedPrimaryKinds.includes(modality);
      try {
        const response = await arkMediaUnderstanding.analyze({
          model,
          reasoningEffort: "off",
          prompt: prompt(modality),
          media: [{ kind: modality, fileId: sdkFileIds[modality] }],
        });
        const parsed = JSON.parse(stripJsonFence(response.text)) as { modality?: string };
        if (parsed.modality !== modality) throw new Error("ARK_MODALITY_RESPONSE_MISMATCH");
        results.push({ model, modality, ok: expectedSupported === true, responseId: response.responseId });
        console.log(
          JSON.stringify({
            model,
            modality,
            status: expectedSupported ? "passed" : "unexpectedly_supported",
            responseId: response.responseId,
          }),
        );
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error))
          .replace(/https?:\/\/[^\s"'<>]+/gi, "[MEDIA_URL]")
          .slice(0, 300);
        results.push({ model, modality, ok: expectedSupported === false, error: message });
        console.log(
          JSON.stringify({
            model,
            modality,
            status: expectedSupported ? "failed" : "unsupported_as_expected",
            error: message,
          }),
        );
      }
    }
  }
  const failed = results.filter((item) => !item.ok);
  console.log(
    JSON.stringify({
      summary: {
        passed: results.length - failed.length,
        failed: failed.length,
        models: models.length,
        cdnOrigin: env.publicMedia.origin,
      },
    }),
  );
  if (failed.length) process.exitCode = 1;
} finally {
  await Promise.allSettled(uploadedArkFileIds.map((fileId) => arkMediaUnderstanding.deleteMedia(fileId)));
  await Promise.allSettled(uploadedKeys.map((key) => ossutils.deleteObject(key)));
  await rm(testDir, { recursive: true, force: true });
}
