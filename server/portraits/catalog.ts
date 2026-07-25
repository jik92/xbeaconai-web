import portraitRecords from "../../public/portraits.json";

export interface PortraitCatalogEntry {
  index: number;
  category: string;
  page: number;
  name: string;
  description: string;
  source_url: string;
  file: string;
}

const portraits = portraitRecords as PortraitCatalogEntry[];
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
