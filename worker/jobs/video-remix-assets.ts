import { existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import type { MediaAsset } from "../../server/accounts/account-store";

interface MaterializeRemixAssetsInput {
  tempDir: string;
  videoAsset: MediaAsset;
  referenceAssets: MediaAsset[];
  tosConfigured: boolean;
  download: (storageKey: string, filePath: string) => Promise<void>;
}

export async function materializeRemoteAsset({
  tempDir,
  asset,
  targetName,
  label,
  tosConfigured,
  download,
}: {
  tempDir: string;
  asset: MediaAsset;
  targetName: string;
  label: string;
  tosConfigured: boolean;
  download: (storageKey: string, filePath: string) => Promise<void>;
}) {
  if (!tosConfigured) throw new Error(`${label}不在本机且 TOS 未配置`);

  const remotePath = resolve(tempDir, targetName);
  try {
    await download(asset.storageKey, remotePath);
  } catch (cause) {
    throw new Error(`${label}从 TOS 下载失败，请稍后重试`, { cause });
  }
  if (!existsSync(remotePath)) throw new Error(`${label}从 TOS 下载失败，请稍后重试`);
  return remotePath;
}

export async function materializeRemixAnalysisAssets(input: MaterializeRemixAssetsInput) {
  const videoPath = await materializeRemixVideoAsset(input);
  const referencePaths = await materializeRemixReferenceAssets(input);
  return { videoPath, referencePaths };
}

export async function materializeRemixVideoAsset(input: Omit<MaterializeRemixAssetsInput, "referenceAssets">) {
  return materializeRemoteAsset({
    ...input,
    asset: input.videoAsset,
    targetName: `source${extname(input.videoAsset.originalName) || ".mp4"}`,
    label: "视频素材",
  });
}

export async function materializeRemixReferenceAssets(input: Omit<MaterializeRemixAssetsInput, "videoAsset">) {
  return Promise.all(
    input.referenceAssets.map((asset, index) =>
      materializeRemoteAsset({
        ...input,
        asset,
        targetName: `product-${index + 1}${extname(asset.originalName) || ".image"}`,
        label: `商品参考图 ${index + 1}`,
      }),
    ),
  );
}
