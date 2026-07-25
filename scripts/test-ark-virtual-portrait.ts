import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { providerCredentials } from "../server/byok/credential-store";
import { probeMedia } from "../server/media/ffmpeg";
import { ArkSeedanceClient } from "../server/providers/ark-seedance";

const model = "doubao-seedance-2-0-mini-260615" as const;
const assetId =
  process.argv.find((argument) => argument.startsWith("--asset="))?.slice("--asset=".length) ??
  "asset-20260224201548-dthqc";
const prompt = "固定机位，近景。图片1中的人物面对镜头微笑并轻轻挥手。人脸清晰，无字幕。";
const outputDirectory = resolve(".data/results");
const desktopDirectory = resolve(homedir(), "Desktop");
const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
const fileName = `ark-seedance-virtual-portrait-${timestamp}.mp4`;
const resultPath = resolve(outputDirectory, fileName);
const desktopPath = resolve(desktopDirectory, fileName);

await mkdir(outputDirectory, { recursive: true });
await mkdir(desktopDirectory, { recursive: true });

const client = new ArkSeedanceClient();
if (!client.configured) throw new Error("ARK_API_KEY 未配置，请先写入加密凭据存储");

try {
  console.log(
    JSON.stringify({
      stage: "submitting",
      model,
      asset: `asset://${assetId}`,
      prompt,
      resolution: "720p",
      ratio: "3:4",
      duration: 5,
      generateAudio: false,
      watermark: false,
    }),
  );
  const created = await client.createVideo({
    model,
    prompt,
    references: [{ kind: "image", url: `asset://${assetId}` }],
    resolution: "720p",
    ratio: "3:4",
    duration: 5,
    generateAudio: false,
    watermark: false,
  });
  console.log(JSON.stringify({ stage: "submitted", taskId: created.id, status: created.status }));

  const completed = await client.waitForVideo(created.id);
  const videoUrl = completed.content?.video_url;
  if (!videoUrl) throw new Error("ARK_VIDEO_URL_MISSING");
  const download = await client.downloadVideo(videoUrl);
  await Promise.all([Bun.write(resultPath, download.bytes), Bun.write(desktopPath, download.bytes)]);

  const media = await probeMedia(resultPath);
  const video = media.streams.find((stream) => stream.codec_type === "video");
  const audio = media.streams.find((stream) => stream.codec_type === "audio");
  console.log(
    JSON.stringify(
      {
        stage: "completed",
        taskId: completed.id,
        status: completed.status,
        videoUrl,
        resultPath,
        desktopPath,
        bytes: download.bytes.byteLength,
        media: {
          duration: Number(media.format.duration ?? video?.duration ?? 0),
          width: video?.width,
          height: video?.height,
          videoCodec: video?.codec_name,
          hasAudio: Boolean(audio),
          audioCodec: audio?.codec_name,
        },
      },
      null,
      2,
    ),
  );
} finally {
  providerCredentials.close();
}
