export interface PortraitRecord {
  index: number;
  category: string;
  page: number;
  name: string;
  description: string;
  source_url: string;
  file: string;
}

export interface Portrait extends PortraitRecord {
  age: number;
  gender: string;
  profession: string;
  display_url: string;
}

export const portraitDisplayUrl = (portraitId: number) => `/api/portraits/${portraitId}/content`;

export function parsePortrait(record: PortraitRecord): Portrait {
  const normalized = record.name.replace(/女性/g, "女").replace(/男性/g, "男");
  const match = normalized.match(/^\S+\s+(\d+)岁\s+([男女])\s+(.+)$/);
  return {
    ...record,
    age: Number(match?.[1] || 0),
    gender: match?.[2] || "未知",
    profession: match?.[3] || normalized,
    display_url: portraitDisplayUrl(record.index),
  };
}

export async function fetchPortraits(): Promise<Portrait[]> {
  const response = await fetch("/portraits.json");
  if (!response.ok) throw new Error("人像清单加载失败");
  return ((await response.json()) as PortraitRecord[]).map(parsePortrait);
}
