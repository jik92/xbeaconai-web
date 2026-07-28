import { isPublicMediaUrl } from "@/api/api-client";
import type { VideoEditorSource } from "../../../shared/video-editor/timeline";

interface UploadedVideoAsset {
  id: string;
  originalUrl: string;
}

interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
}

interface VideoEditorUploadDependencies {
  upload: (file: File) => Promise<UploadedVideoAsset>;
  readMetadata: (url: string) => Promise<VideoMetadata>;
}

export async function prepareVideoEditorSource(
  file: File,
  dependencies: VideoEditorUploadDependencies,
): Promise<Omit<VideoEditorSource, "id">> {
  const asset = await dependencies.upload(file);
  if (!isPublicMediaUrl(asset.originalUrl)) throw new Error("视频上传完成，但未返回 CDN 地址");
  const metadata = await dependencies.readMetadata(asset.originalUrl);
  return {
    assetId: asset.id,
    name: file.name,
    url: asset.originalUrl,
    durationSec: metadata.duration,
    width: metadata.width,
    height: metadata.height,
  };
}
