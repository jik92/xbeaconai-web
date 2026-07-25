import { parsePortraitTags } from "../../../shared/portraits/portrait-tags";
import type { PortraitReference } from "../../../shared/portraits/portrait-reference";
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
  display_url: string;
  status: "active" | "queued" | "processing" | "failed";
}

export const portraitDisplayUrl = (portraitId: number) => `/api/portraits/${portraitId}/content`;

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
  return {
    ...record,
    key: `general:${record.index}`,
    type: "general",
    reference: { type: "general", portraitId: record.index },
    age: tags?.age ?? 0,
    gender: tags?.gender ?? "未知",
    profession: tags?.profession ?? record.name,
    display_url: portraitDisplayUrl(record.index),
    status: "active",
  };
}

export async function fetchPortraits(): Promise<Portrait[]> {
  const [response, customPortraits] = await Promise.all([fetch("/portraits.json"), fetchCustomPortraits()]);
  if (!response.ok) throw new Error("人像清单加载失败");
  const general = ((await response.json()) as PortraitRecord[]).map(parsePortrait);
  const custom: CustomPortrait[] = customPortraits.map((portrait) => {
    const tags = parsePortraitTags(portrait.name);
    return {
      key: `custom:${portrait.assetId}`,
      type: "custom",
      reference: { type: "custom", assetId: portrait.assetId },
      assetId: portrait.assetId,
      jobId: portrait.jobId,
      name: portrait.name,
      description: portrait.description ?? "自建虚拟人像",
      source_url: portrait.imageUrl,
      display_url: portrait.imageUrl,
      age: tags?.age ?? 0,
      gender: tags?.gender ?? "未知",
      profession: tags?.profession ?? "自建人像",
      status: portrait.status,
      errorMessage: portrait.errorMessage,
    };
  });
  return [...custom, ...general];
}
