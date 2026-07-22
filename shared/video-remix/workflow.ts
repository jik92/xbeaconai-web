export const remixMaxSources = 20;

export interface RemixSourceRef {
  assetId: string;
  name: string;
}

export interface RemixAnalysisEntry extends RemixSourceRef {
  status: "succeeded" | "failed";
  prompt?: string;
  transcript?: string;
  error?: string;
}

export interface RemixComposeSource {
  sourceAssetId: string;
  selectedAssetId: string;
}

export function parseRemixSources(raw: string | undefined): RemixSourceRef[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed
      .filter(
        (item): item is RemixSourceRef =>
          Boolean(item) && typeof item.assetId === "string" && typeof item.name === "string",
      )
      .filter((item) => {
        if (seen.has(item.assetId)) return false;
        seen.add(item.assetId);
        return true;
      })
      .slice(0, remixMaxSources);
  } catch {
    return [];
  }
}

export function parseRemixAnalysisEntries(raw: string | undefined): RemixAnalysisEntry[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RemixAnalysisEntry =>
        Boolean(item) &&
        typeof item.assetId === "string" &&
        typeof item.name === "string" &&
        (item.status === "succeeded" || item.status === "failed") &&
        (item.prompt === undefined || typeof item.prompt === "string") &&
        (item.transcript === undefined || typeof item.transcript === "string") &&
        (item.error === undefined || typeof item.error === "string"),
    );
  } catch {
    return [];
  }
}

export function moveRemixSource<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length)
    return [...items];
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  if (moved === undefined) return [...items];
  next.splice(toIndex, 0, moved);
  return next;
}

export function parseRemixComposeSources(raw: string | undefined): RemixComposeSource[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RemixComposeSource =>
        Boolean(item) && typeof item.sourceAssetId === "string" && typeof item.selectedAssetId === "string",
    );
  } catch {
    return [];
  }
}
