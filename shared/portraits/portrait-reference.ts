export type PortraitReference = { type: "general"; portraitId: number } | { type: "custom"; assetId: string };

export function normalizePortraitReference(
  reference: PortraitReference | undefined,
  legacyPortraitId?: number,
): PortraitReference | undefined {
  return reference ?? (legacyPortraitId ? { type: "general", portraitId: legacyPortraitId } : undefined);
}

export function serializePortraitReference(reference: PortraitReference | undefined) {
  return reference ? JSON.stringify(reference) : undefined;
}

export function parsePortraitReference(value: string | undefined, legacyPortraitId?: string) {
  if (value) {
    try {
      const parsed = JSON.parse(value) as Partial<PortraitReference>;
      if (parsed.type === "general" && Number.isInteger(parsed.portraitId) && Number(parsed.portraitId) > 0)
        return { type: "general", portraitId: Number(parsed.portraitId) } satisfies PortraitReference;
      if (parsed.type === "custom" && typeof parsed.assetId === "string" && parsed.assetId)
        return { type: "custom", assetId: parsed.assetId } satisfies PortraitReference;
    } catch {
      return undefined;
    }
  }
  const numericId = Number(legacyPortraitId);
  return Number.isInteger(numericId) && numericId > 0
    ? ({ type: "general", portraitId: numericId } satisfies PortraitReference)
    : undefined;
}

export function portraitReferenceKey(reference: PortraitReference) {
  return reference.type === "general" ? `general:${reference.portraitId}` : `custom:${reference.assetId}`;
}
