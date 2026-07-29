import type { MediaAsset } from "../accounts/account-store";

const supportedPrimaryPrefixes = ["image/", "video/", "audio/"] as const;

export class MediaUnderstandValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function resolveMediaUnderstandAssets(
  ownerUserId: string,
  input: { primaryAssetId: string; referenceImageAssetIds: string[] },
  getOwnedAsset: (ownerUserId: string, assetId: string) => MediaAsset | undefined,
) {
  const primary = getOwnedAsset(ownerUserId, input.primaryAssetId);
  if (!primary)
    throw new MediaUnderstandValidationError("MEDIA_UNDERSTAND_PRIMARY_NOT_FOUND", "主素材不存在或不属于当前账号");
  if (!supportedPrimaryPrefixes.some((prefix) => primary.mimeType.startsWith(prefix)))
    throw new MediaUnderstandValidationError(
      "MEDIA_UNDERSTAND_PRIMARY_TYPE_UNSUPPORTED",
      "主素材仅支持图片、视频或音频",
    );
  const references = input.referenceImageAssetIds.map((assetId) => {
    const asset = getOwnedAsset(ownerUserId, assetId);
    if (!asset)
      throw new MediaUnderstandValidationError(
        "MEDIA_UNDERSTAND_REFERENCE_NOT_FOUND",
        "商品参考素材不存在或不属于当前账号",
      );
    if (!asset.mimeType.startsWith("image/"))
      throw new MediaUnderstandValidationError("MEDIA_UNDERSTAND_REFERENCE_TYPE_UNSUPPORTED", "商品参考素材必须是图片");
    return asset;
  });
  return { primary, references };
}
