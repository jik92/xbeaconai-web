function normalizeObject(value: Record<string, unknown>) {
  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, normalizeOpenApi31ExclusiveBounds(child)]),
  );

  if (normalized.exclusiveMinimum === true && typeof normalized.minimum === "number") {
    normalized.exclusiveMinimum = normalized.minimum;
    delete normalized.minimum;
  }
  if (normalized.exclusiveMaximum === true && typeof normalized.maximum === "number") {
    normalized.exclusiveMaximum = normalized.maximum;
    delete normalized.maximum;
  }
  return normalized;
}

export function normalizeOpenApi31ExclusiveBounds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeOpenApi31ExclusiveBounds);
  if (value && typeof value === "object") return normalizeObject(value as Record<string, unknown>);
  return value;
}
