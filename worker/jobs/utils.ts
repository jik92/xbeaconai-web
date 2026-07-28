export function assetIdsFromValues(values: Record<string, string>) {
  const ids = new Set<string>();
  for (const value of Object.values(values)) {
    if (value.startsWith("asset:")) {
      const id = value.split(":", 3)[1];
      if (id) ids.add(id);
    }
    if (value.startsWith("assets:"))
      try {
        for (const item of JSON.parse(value.slice(7)) as Array<{ id?: unknown }>) {
          if (typeof item.id === "string" && !item.id.startsWith("library-")) ids.add(item.id);
        }
      } catch {
        /* request validation reports malformed values separately */
      }
  }
  try {
    const referenceAssetIds = JSON.parse(values.referenceAssetIds ?? "[]") as unknown;
    if (Array.isArray(referenceAssetIds))
      for (const id of referenceAssetIds) {
        if (typeof id === "string" && !id.startsWith("library-")) ids.add(id);
      }
  } catch {
    /* AI Generate persists this field as JSON; its request parser reports malformed values separately. */
  }
  return [...ids];
}
