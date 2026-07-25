import type { PortraitReference } from "../../shared/portraits/portrait-reference";
import type { AccountStore } from "../accounts/account-store";
import { getPortraitArkAssetUri, getPortraitById } from "./catalog";
import type { CustomPortraitStore } from "./custom-portrait-store";

export interface ResolvedPortraitReference {
  reference: PortraitReference;
  name: string;
  description?: string;
  imageUrl: string;
  arkAssetUri: string;
  mimeType: string;
}

export function resolvePortraitReference(input: {
  ownerUserId: string;
  reference: PortraitReference;
  accounts: AccountStore;
  customPortraits: CustomPortraitStore;
}): ResolvedPortraitReference | undefined {
  if (input.reference.type === "general") {
    const portrait = getPortraitById(input.reference.portraitId);
    return portrait
      ? {
          reference: input.reference,
          name: portrait.name,
          description: portrait.description,
          imageUrl: portrait.source_url,
          arkAssetUri: getPortraitArkAssetUri(portrait),
          mimeType: "image/jpeg",
        }
      : undefined;
  }
  const portrait = input.customPortraits.getOwned(input.ownerUserId, input.reference.assetId);
  const asset = input.accounts.getOwnedAsset(input.ownerUserId, input.reference.assetId);
  if (portrait?.status !== "active" || !portrait.arkAssetId || !asset || asset.kind !== "portrait") return undefined;
  return {
    reference: input.reference,
    name: asset.displayName,
    description: asset.description,
    imageUrl: `/api/assets/${asset.id}/content`,
    arkAssetUri: `asset://${portrait.arkAssetId}`,
    mimeType: asset.mimeType,
  };
}
