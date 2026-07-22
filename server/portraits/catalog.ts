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

export function getPortraitById(id: number | undefined) {
  return id === undefined ? undefined : portraitsById.get(id);
}
