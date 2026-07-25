import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, relative, resolve } from "node:path";
import type { AccountStore } from "../accounts/account-store";
import { env } from "../env";
import { probeMedia } from "../media/ffmpeg";
import { ossutils } from "../storage/ossutils";

export interface QwenVoiceSamplePreflight {
  durationSec: number;
  format: string;
  channels?: number;
  sampleRate?: number;
}

export class QwenVoiceSamplePreflightError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function seconds(value: number) {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

export function validateQwenVoiceSampleProbe(input: {
  durationSec: number;
  hasAudioStream: boolean;
  format: string;
  channels?: number;
  sampleRate?: number;
}): QwenVoiceSamplePreflight {
  if (!input.hasAudioStream)
    throw new QwenVoiceSamplePreflightError("QWEN_VOICE_AUDIO_STREAM_MISSING", "录音中没有可识别的音频流");
  if (!Number.isFinite(input.durationSec) || input.durationSec <= 0)
    throw new QwenVoiceSamplePreflightError("QWEN_VOICE_DURATION_UNKNOWN", "无法读取录音时长，请重新导出后上传");
  if (input.durationSec < 5)
    throw new QwenVoiceSamplePreflightError(
      "QWEN_VOICE_SAMPLE_TOO_SHORT",
      `当前录音 ${seconds(input.durationSec)} 秒，至少需要 5 秒`,
    );
  if (input.durationSec > 60)
    throw new QwenVoiceSamplePreflightError(
      "QWEN_VOICE_SAMPLE_TOO_LONG",
      `当前录音 ${seconds(input.durationSec)} 秒，不能超过 60 秒`,
    );
  return {
    durationSec: input.durationSec,
    format: input.format,
    channels: input.channels,
    sampleRate: input.sampleRate,
  };
}

export async function preflightQwenVoiceSample(
  ownerUserId: string,
  assetId: string,
  accounts: AccountStore,
): Promise<QwenVoiceSamplePreflight> {
  const asset = accounts.getOwnedAsset(ownerUserId, assetId);
  if (!asset?.mimeType.startsWith("audio/"))
    throw new QwenVoiceSamplePreflightError("QWEN_VOICE_SAMPLE_NOT_FOUND", "录音不存在或不属于当前账号");
  if (asset.byteSize > 10 * 1024 * 1024)
    throw new QwenVoiceSamplePreflightError("QWEN_VOICE_SAMPLE_TOO_LARGE", "录音不能超过 10MB");

  const tempDir = await mkdtemp(resolve(tmpdir(), "yaozuo-qwen-preflight-"));
  try {
    const uploadRoot = resolve(env.dataDir, "uploads");
    const localPath = resolve(uploadRoot, asset.storageKey);
    const localRelative = relative(uploadRoot, localPath);
    const safeLocalPath =
      localRelative && !localRelative.startsWith("..") && !localRelative.startsWith("/") && existsSync(localPath)
        ? localPath
        : undefined;
    const samplePath = safeLocalPath ?? resolve(tempDir, `sample${extname(asset.originalName) || ".audio"}`);
    if (!safeLocalPath) {
      if (!ossutils.configured)
        throw new QwenVoiceSamplePreflightError("QWEN_VOICE_SAMPLE_UNAVAILABLE", "录音文件暂时无法读取，请稍后重试");
      await ossutils.downloadLibraryFile(asset.storageKey, samplePath);
    }
    let media: Awaited<ReturnType<typeof probeMedia>>;
    try {
      media = await probeMedia(samplePath);
    } catch {
      throw new QwenVoiceSamplePreflightError(
        "QWEN_VOICE_SAMPLE_UNREADABLE",
        "无法解析录音，请上传 WAV、MP3、OGG、M4A 或 AAC 文件",
      );
    }
    const audio = media.streams.find((stream) => stream.codec_type === "audio");
    const result = validateQwenVoiceSampleProbe({
      durationSec: Number(media.format.duration ?? audio?.duration ?? 0),
      hasAudioStream: Boolean(audio),
      format: media.format.format_name?.split(",")[0] ?? extname(asset.originalName).slice(1),
      channels: audio?.channels,
      sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : undefined,
    });
    accounts.updateAssetMetadata(ownerUserId, assetId, { durationSec: result.durationSec });
    return result;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
