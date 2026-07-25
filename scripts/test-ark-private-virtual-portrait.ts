import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { providerCredentials } from "../server/byok/credential-store";
import { probeMedia } from "../server/media/ffmpeg";
import { ArkAssetsClient } from "../server/providers/ark-assets";
import { ArkSeedanceClient } from "../server/providers/ark-seedance";
import { ossutils } from "../server/storage/ossutils";

interface FlowState {
  groupId?: string;
  assetId?: string;
  assetStatus?: string;
  stagedKey?: string;
  stagingCleaned?: boolean;
  videoTaskId?: string;
  desktopPath?: string;
}

const inputPath = resolve(homedir(), "Desktop/e8f8db3de382a29b1ea2bab2a613c3e3.jpg");
const source = Bun.file(inputPath);
if (!(await source.exists())) throw new Error(`输入图片不存在：${inputPath}`);
if (source.size >= 30 * 1024 * 1024) throw new Error("输入图片超过 Ark 30 MB 限制");

const outputDirectory = resolve(".data/results");
const desktopDirectory = resolve(homedir(), "Desktop");
const statePath = resolve(outputDirectory, "ark-private-virtual-portrait-e8f8db3d.json");
await Promise.all([mkdir(outputDirectory, { recursive: true }), mkdir(desktopDirectory, { recursive: true })]);

let state: FlowState = {};
if (!process.argv.includes("--fresh")) {
  try {
    state = (await Bun.file(statePath).json()) as FlowState;
  } catch {
    /* first run */
  }
}
const saveState = async () => Bun.write(statePath, `${JSON.stringify(state, null, 2)}\n`);

const assets = new ArkAssetsClient();
const video = new ArkSeedanceClient();
if (!assets.configured) throw new Error("火山 AK/SK 未配置");
if (!video.configured) throw new Error("ARK_API_KEY 未配置");
if (!ossutils.configured) throw new Error("TOS 未配置");

try {
  if (!state.stagedKey && !state.assetId) {
    const bytes = new Uint8Array(await source.arrayBuffer());
    const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const staged = await ossutils.putStagedFile({
      filePath: inputPath,
      sizeBytes: bytes.byteLength,
      sha256,
      mimeType: "image/jpeg",
      jobId: `ark-assets-${crypto.randomUUID()}`,
      extension: ".jpg",
    });
    state.stagedKey = staged.key;
    await saveState();
    console.log(JSON.stringify({ stage: "tos_staged", bytes: bytes.byteLength }));
  }

  if (!state.groupId) {
    const timestamp = new Date()
      .toISOString()
      .replaceAll(/[-:TZ.]/g, "")
      .slice(0, 14);
    const group = await assets.createAssetGroup({
      name: `codex-virtual-portrait-${timestamp}`,
      description: "Ark API virtual portrait upload verification",
      projectName: "default",
    });
    state.groupId = group.Id;
    await saveState();
    console.log(JSON.stringify({ stage: "group_created", groupId: group.Id }));
  }

  if (!state.assetId) {
    if (!state.stagedKey) throw new Error("TOS 暂存对象不存在");
    const asset = await assets.createAsset({
      groupId: state.groupId,
      url: ossutils.createSignedReadUrl(state.stagedKey, 24 * 60 * 60),
      name: "virtual-portrait-e8f8db3d",
      assetType: "Image",
      projectName: "default",
    });
    state.assetId = asset.Id;
    state.assetStatus = "Processing";
    await saveState();
    console.log(JSON.stringify({ stage: "asset_created", groupId: state.groupId, assetId: asset.Id }));
  }

  const activeAsset = await assets.waitForAsset(state.assetId);
  state.assetStatus = activeAsset.Status;
  await saveState();
  console.log(JSON.stringify({ stage: "asset_active", assetId: activeAsset.Id, status: activeAsset.Status }));

  if (state.stagedKey && !state.stagingCleaned) {
    await ossutils.markCleanupReady(state.stagedKey).catch(() => undefined);
    await ossutils.deleteObject(state.stagedKey);
    state.stagingCleaned = true;
    state.stagedKey = undefined;
    await saveState();
  }

  if (!state.videoTaskId) {
    const task = await video.createVideo({
      model: "doubao-seedance-2-0-mini-260615",
      prompt: "固定机位，近景。图片1中的人物面对镜头微笑并轻轻挥手。保持人物脸型、五官和发型一致，无字幕。",
      references: [{ kind: "image", url: `asset://${state.assetId}` }],
      resolution: "720p",
      ratio: "3:4",
      duration: 5,
      generateAudio: false,
      watermark: false,
    });
    state.videoTaskId = task.id;
    await saveState();
    console.log(JSON.stringify({ stage: "video_submitted", taskId: task.id, assetId: state.assetId }));
  }

  const completed = await video.waitForVideo(state.videoTaskId);
  const videoUrl = completed.content?.video_url;
  if (!videoUrl) throw new Error("ARK_VIDEO_URL_MISSING");
  const download = await video.downloadVideo(videoUrl);
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const fileName = `ark-private-virtual-portrait-${timestamp}.mp4`;
  const resultPath = resolve(outputDirectory, fileName);
  const desktopPath = resolve(desktopDirectory, fileName);
  await Promise.all([Bun.write(resultPath, download.bytes), Bun.write(desktopPath, download.bytes)]);
  state.desktopPath = desktopPath;
  await saveState();

  const media = await probeMedia(resultPath);
  const videoStream = media.streams.find((stream) => stream.codec_type === "video");
  const audioStream = media.streams.find((stream) => stream.codec_type === "audio");
  console.log(
    JSON.stringify(
      {
        stage: "completed",
        groupId: state.groupId,
        assetId: state.assetId,
        assetStatus: state.assetStatus,
        taskId: completed.id,
        desktopPath,
        bytes: download.bytes.byteLength,
        media: {
          duration: Number(media.format.duration ?? videoStream?.duration ?? 0),
          width: videoStream?.width,
          height: videoStream?.height,
          videoCodec: videoStream?.codec_name,
          hasAudio: Boolean(audioStream),
        },
      },
      null,
      2,
    ),
  );
} finally {
  providerCredentials.close();
}
