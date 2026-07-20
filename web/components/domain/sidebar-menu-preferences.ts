export interface SidebarMenuPreferences {
  order: Record<string, string[]>;
  hidden: string[];
}

export type SidebarMenuDefaults = Readonly<Record<string, readonly string[]>>;

export function createDefaultSidebarMenuPreferences(defaults: SidebarMenuDefaults): SidebarMenuPreferences {
  return {
    order: Object.fromEntries(Object.entries(defaults).map(([group, itemIds]) => [group, [...itemIds]])),
    hidden: [],
  };
}

export function normalizeSidebarMenuPreferences(value: unknown, defaults: SidebarMenuDefaults): SidebarMenuPreferences {
  const fallback = createDefaultSidebarMenuPreferences(defaults);
  if (!value || typeof value !== "object") return fallback;

  const candidate = value as { order?: unknown; hidden?: unknown };
  const candidateOrder =
    candidate.order && typeof candidate.order === "object" ? (candidate.order as Record<string, unknown>) : {};
  const allItemIds = new Set(Object.values(defaults).flat());
  const order = Object.fromEntries(
    Object.entries(defaults).map(([group, defaultItemIds]) => {
      const savedItemIds = Array.isArray(candidateOrder[group]) ? candidateOrder[group] : [];
      const knownSavedItemIds = savedItemIds.filter(
        (itemId, index): itemId is string =>
          typeof itemId === "string" && defaultItemIds.includes(itemId) && savedItemIds.indexOf(itemId) === index,
      );
      return [group, [...knownSavedItemIds, ...defaultItemIds.filter((itemId) => !knownSavedItemIds.includes(itemId))]];
    }),
  );
  const savedHiddenItemIds = Array.isArray(candidate.hidden) ? candidate.hidden : [];
  const hidden = savedHiddenItemIds.length
    ? savedHiddenItemIds.filter(
        (itemId, index): itemId is string =>
          typeof itemId === "string" && allItemIds.has(itemId) && savedHiddenItemIds.indexOf(itemId) === index,
      )
    : [];

  return { order, hidden };
}

export function reorderSidebarMenuItem(
  preferences: SidebarMenuPreferences,
  group: string,
  itemId: string,
  targetId: string,
): SidebarMenuPreferences {
  const itemIds = preferences.order[group];
  if (!itemIds || itemId === targetId) return preferences;
  const fromIndex = itemIds.indexOf(itemId);
  const targetIndex = itemIds.indexOf(targetId);
  if (fromIndex < 0 || targetIndex < 0) return preferences;

  const nextItemIds = [...itemIds];
  nextItemIds.splice(fromIndex, 1);
  nextItemIds.splice(targetIndex, 0, itemId);
  return { ...preferences, order: { ...preferences.order, [group]: nextItemIds } };
}

export function moveSidebarMenuItem(
  preferences: SidebarMenuPreferences,
  group: string,
  itemId: string,
  offset: -1 | 1,
): SidebarMenuPreferences {
  const itemIds = preferences.order[group];
  const fromIndex = itemIds?.indexOf(itemId) ?? -1;
  const targetId = itemIds?.[fromIndex + offset];
  return targetId ? reorderSidebarMenuItem(preferences, group, itemId, targetId) : preferences;
}

export function toggleSidebarMenuItem(preferences: SidebarMenuPreferences, itemId: string): SidebarMenuPreferences {
  return preferences.hidden.includes(itemId)
    ? { ...preferences, hidden: preferences.hidden.filter((hiddenId) => hiddenId !== itemId) }
    : { ...preferences, hidden: [...preferences.hidden, itemId] };
}
