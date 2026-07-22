import type { RemixAnalysisEntry } from "./workflow";

export const remixProjectStages = [
  "upload",
  "analysis",
  "prompt",
  "storyboard",
  "compose",
  "completed",
  "failed",
] as const;
export type RemixProjectStage = (typeof remixProjectStages)[number];

export interface RemixPromptVersion {
  id: string;
  label: string;
  prompt: string;
}

export interface RemixSourcePromptState {
  prompt: string;
  versions: RemixPromptVersion[];
  activeVersionId: string;
}

export interface RemixWorkspaceState {
  stage: number;
  promptStates: Record<string, RemixSourcePromptState>;
  selectedShotAssets: Record<string, string>;
  composeOrder: string[];
  composePreviewId: string;
}

export const defaultRemixWorkspace = (sourceIds: string[] = []): RemixWorkspaceState => ({
  stage: sourceIds.length ? 2 : 0,
  promptStates: {},
  selectedShotAssets: Object.fromEntries(sourceIds.map((sourceId) => [sourceId, sourceId])),
  composeOrder: sourceIds,
  composePreviewId: sourceIds[0] ?? "",
});

export function parseRemixWorkspace(
  raw: string | undefined,
  sourceIds: string[],
  analysisEntries: RemixAnalysisEntry[],
): RemixWorkspaceState {
  const defaults = defaultRemixWorkspace(sourceIds);
  let parsed: Partial<RemixWorkspaceState> = {};
  try {
    const value = JSON.parse(raw || "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Partial<RemixWorkspaceState>;
  } catch {
    parsed = {};
  }
  const allowedSources = new Set(sourceIds);
  const promptStates: Record<string, RemixSourcePromptState> = {};
  if (parsed.promptStates && typeof parsed.promptStates === "object") {
    for (const [sourceId, value] of Object.entries(parsed.promptStates)) {
      if (!allowedSources.has(sourceId) || !value || typeof value !== "object") continue;
      const candidate = value as Partial<RemixSourcePromptState>;
      if (typeof candidate.prompt !== "string" || !Array.isArray(candidate.versions)) continue;
      const versions = candidate.versions.filter(
        (version): version is RemixPromptVersion =>
          Boolean(version) &&
          typeof version.id === "string" &&
          typeof version.label === "string" &&
          typeof version.prompt === "string",
      );
      promptStates[sourceId] = {
        prompt: candidate.prompt,
        versions,
        activeVersionId: typeof candidate.activeVersionId === "string" ? candidate.activeVersionId : "",
      };
    }
  }
  for (const entry of analysisEntries) {
    if (entry.status !== "succeeded" || !entry.prompt || promptStates[entry.assetId]) continue;
    const versionId = `analysis:${entry.assetId}`;
    promptStates[entry.assetId] = {
      prompt: entry.prompt,
      versions: [{ id: versionId, label: "AI解析", prompt: entry.prompt }],
      activeVersionId: versionId,
    };
  }
  const selectedShotAssets = { ...defaults.selectedShotAssets };
  if (parsed.selectedShotAssets && typeof parsed.selectedShotAssets === "object")
    for (const [sourceId, selectedId] of Object.entries(parsed.selectedShotAssets))
      if (allowedSources.has(sourceId) && typeof selectedId === "string") selectedShotAssets[sourceId] = selectedId;
  const requestedOrder = Array.isArray(parsed.composeOrder)
    ? parsed.composeOrder.filter(
        (sourceId): sourceId is string => typeof sourceId === "string" && allowedSources.has(sourceId),
      )
    : [];
  const composeOrder =
    requestedOrder.length === sourceIds.length && new Set(requestedOrder).size === sourceIds.length
      ? requestedOrder
      : sourceIds;
  const composePreviewId =
    typeof parsed.composePreviewId === "string" && allowedSources.has(parsed.composePreviewId)
      ? parsed.composePreviewId
      : (composeOrder[0] ?? "");
  return {
    stage: Number.isInteger(parsed.stage) ? Math.min(4, Math.max(0, Number(parsed.stage))) : defaults.stage,
    promptStates,
    selectedShotAssets,
    composeOrder,
    composePreviewId,
  };
}
