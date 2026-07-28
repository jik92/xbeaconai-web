import portraitRecords from "../../public/portraits.json";
import { systemPortraitMedia } from "../../shared/media/system-media";

export interface PortraitCatalogEntry {
  index: number;
  category: string;
  page: number;
  name: string;
  description: string;
  source_url: string;
  file: string;
  thumbnail_url: string;
  display_url: string;
  original_url: string;
}

const portraits = (
  portraitRecords as Omit<PortraitCatalogEntry, "thumbnail_url" | "display_url" | "original_url">[]
).map((portrait) => {
  const media = systemPortraitMedia(portrait.index);
  return {
    ...portrait,
    thumbnail_url: media.thumbnailUrl,
    display_url: media.url,
    original_url: media.originalUrl,
  };
});
const portraitsById = new Map(portraits.map((portrait) => [portrait.index, portrait]));

const arkAssetIdPattern = /(?:^|\/)(asset-[a-zA-Z0-9-]+)/u;

export function getPortraitArkAssetUri(portrait: PortraitCatalogEntry) {
  const assetId = new URL(portrait.source_url).pathname.match(arkAssetIdPattern)?.[1];
  if (!assetId) throw new Error(`PORTRAIT_ARK_ASSET_ID_MISSING:${portrait.index}`);
  return `asset://${assetId}`;
}

export function getPortraitById(id: number | undefined) {
  return id === undefined ? undefined : portraitsById.get(id);
}
