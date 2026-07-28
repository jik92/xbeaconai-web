import { extname } from "node:path";
import type { MediaAsset } from "../accounts/account-store";

interface ArtifactRecord {
  storageKey: string;
  name: string;
  mimeType: string;
  jobId: string;
}

interface AssetFolderRef {
  id: string;
  storagePrefix: string;
}

interface LocalFileRef {
  path: string;
  size: number;
  exists: boolean;
}

interface ArtifactPublicMediaDependencies {
  getOwnedAsset: () => MediaAsset | undefined;
  getArtifact: () => ArtifactRecord | undefined;
  getDefaultFolder: () => AssetFolderRef | undefined;
  getLocalFile: (storageKey: string) => LocalFileRef | undefined | Promise<LocalFileRef | undefined>;
  upload: (input: { filePath: string; key: string; mimeType: string; sizeBytes: number }) => Promise<void>;
  createAsset: (asset: MediaAsset) => void;
  now: () => string;
}

function mediaExtension(name: string) {
  const extension = extname(name).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : "";
}

export async function persistArtifactMedia(
  input: { userId: string; artifactId: string },
  dependencies: ArtifactPublicMediaDependencies,
) {
  const existing = dependencies.getOwnedAsset();
  if (existing) return existing;
  const artifact = dependencies.getArtifact();
  if (!artifact || !/^(image|video|audio)\//.test(artifact.mimeType)) return;
  const folder = dependencies.getDefaultFolder();
  const localFile = await dependencies.getLocalFile(artifact.storageKey);
  if (!folder || !localFile?.exists || localFile.size <= 0) return;
  const storageKey = `${folder.storagePrefix}generated/${artifact.jobId}/${input.artifactId}${mediaExtension(artifact.name)}`;
  await dependencies.upload({
    filePath: localFile.path,
    key: storageKey,
    mimeType: artifact.mimeType,
    sizeBytes: localFile.size,
  });
  const asset: MediaAsset = {
    id: input.artifactId,
    ownerUserId: input.userId,
    storageKey,
    originalName: artifact.name,
    mimeType: artifact.mimeType,
    byteSize: localFile.size,
    kind: "media",
    displayName: artifact.name,
    folderId: folder.id,
    createdAt: dependencies.now(),
  };
  dependencies.createAsset(asset);
  return asset;
}
