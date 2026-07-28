import type { PortraitReference } from "../../../shared/portraits/portrait-reference";
import { parsePortraitTags } from "../../../shared/portraits/portrait-tags";
import { systemPortraitMedia } from "../../../shared/media/system-media";
import { fetchCustomPortraits } from "../../api/api-client";

export interface PortraitRecord {
  index: number;
  category: string;
  page: number;
  name: string;
  description: string;
  source_url: string;
  file: string;
}

interface PortraitBase {
  key: string;
  type: "general" | "custom";
  reference: PortraitReference;
  name: string;
  description: string;
  source_url: string;
  age: number;
  gender: string;
  profession: string;
  thumbnail_url: string;
  display_url: string;
  original_url: string;
  status: "active" | "queued" | "processing" | "failed";
}

export interface GeneralPortrait extends PortraitBase, PortraitRecord {
  type: "general";
  reference: { type: "general"; portraitId: number };
  status: "active";
}

export interface CustomPortrait extends PortraitBase {
  type: "custom";
  reference: { type: "custom"; assetId: string };
  assetId: string;
  jobId?: string;
  errorMessage?: string;
}

export type Portrait = GeneralPortrait | CustomPortrait;

export function parsePortrait(record: PortraitRecord): GeneralPortrait {
  const tags = parsePortraitTags(record.name);
  const media = systemPortraitMedia(record.index);
  return {
    ...record,
    key: `general:${record.index}`,
    type: "general",
    reference: { type: "general", portraitId: record.index },
    age: tags?.age ?? 0,
    gender: tags?.gender ?? "未知",
    profession: tags?.profession ?? record.name,
    thumbnail_url: media.thumbnailUrl,
    display_url: media.url,
    original_url: media.originalUrl,
    status: "active",
  };
}

type CustomPortraitResponse = Awaited<ReturnType<typeof fetchCustomPortraits>>[number];

export function parseCustomPortrait(portrait: CustomPortraitResponse): CustomPortrait {
  const tags = parsePortraitTags(portrait.name);
  return {
    key: `custom:${portrait.assetId}`,
    type: "custom",
    reference: { type: "custom", assetId: portrait.assetId },
    assetId: portrait.assetId,
    jobId: portrait.jobId,
    name: portrait.name,
    description: portrait.description ?? "自建虚拟人像",
    source_url: portrait.originalUrl,
    thumbnail_url: portrait.thumbnailUrl,
    display_url: portrait.imageUrl,
    original_url: portrait.originalUrl,
    age: tags?.age ?? 0,
    gender: portrait.gender ?? tags?.gender ?? "未知",
    profession: tags?.profession ?? "自建人像",
    status: portrait.status,
    errorMessage: portrait.errorMessage,
  };
}

export async function fetchPortraits(): Promise<Portrait[]> {
  const [response, customPortraits] = await Promise.all([fetch("/portraits.json"), fetchCustomPortraits()]);
  if (!response.ok) throw new Error("人像清单加载失败");
  const general = ((await response.json()) as PortraitRecord[]).map(parsePortrait);
  const custom = customPortraits.map(parseCustomPortrait);
  return [...custom, ...general];
}
