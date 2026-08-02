export const scriptRemixNextMaxShots = 9;
export const scriptRemixNextTextMimeTypes = ["text/plain", "text/markdown"] as const;
export const scriptRemixNextAnalysisModel = "gpt-5.6-sol";
export const scriptRemixNextImageModel = "gpt-image-2";

export interface ScriptRemixNextShot {
  id: string;
  ordinal: number;
  title: string;
  speech: string;
  visual: string;
  action: string;
  camera: string;
  durationSeconds: number;
  productRequirement: string;
  characterRequirement: string;
}

export interface ScriptRemixNextWorkspace {
  stage: 0 | 1 | 2 | 3;
  shots: ScriptRemixNextShot[];
  analysisVersion: number;
  storyboardAssetId: string;
  storyboardVersion: number;
  referenceAssetIds: Record<string, string>;
  selectedVideoAssetIds: Record<string, string>;
  composeOrder: string[];
  globalVideoSettings: {
    modelId: "doubao-seedance-2-0-260128" | "doubao-seedance-2-0-mini-260615" | "doubao-seedance-2-0-fast-260128";
    ratio: string;
    resolution: string;
    duration: number;
  };
  shotVideoSettings: Record<
    string,
    Partial<{
      modelId: "doubao-seedance-2-0-260128" | "doubao-seedance-2-0-mini-260615" | "doubao-seedance-2-0-fast-260128";
      ratio: string;
      resolution: string;
      duration: number;
    }>
  >;
}

export function createScriptRemixNextWorkspace(): ScriptRemixNextWorkspace {
  return {
    stage: 0,
    shots: [],
    analysisVersion: 0,
    storyboardAssetId: "",
    storyboardVersion: 0,
    referenceAssetIds: {},
    selectedVideoAssetIds: {},
    composeOrder: [],
    globalVideoSettings: {
      modelId: "doubao-seedance-2-0-fast-260128",
      ratio: "9:16",
      resolution: "720p",
      duration: 8,
    },
    shotVideoSettings: {},
  };
}

export function normalizeScriptRemixNextShots(input: readonly ScriptRemixNextShot[]) {
  const normalized = input.map((shot, index) => ({ ...shot, ordinal: index + 1 }));
  if (normalized.length <= scriptRemixNextMaxShots) return normalized;
  const kept = normalized.slice(0, scriptRemixNextMaxShots);
  const overflow = normalized.slice(scriptRemixNextMaxShots - 1);
  const last = overflow[0];
  if (!last) return kept;
  kept[scriptRemixNextMaxShots - 1] = {
    ...last,
    ordinal: scriptRemixNextMaxShots,
    title: last.title || `分镜 ${scriptRemixNextMaxShots}`,
    speech: overflow.map((shot) => shot.speech).join("\n"),
    visual: overflow.map((shot) => shot.visual).join("；"),
    action: overflow.map((shot) => shot.action).join("；"),
    camera: overflow.map((shot) => shot.camera).join("；"),
    durationSeconds: overflow.reduce((total, shot) => total + shot.durationSeconds, 0),
    productRequirement: overflow
      .map((shot) => shot.productRequirement)
      .filter(Boolean)
      .join("；"),
    characterRequirement: overflow
      .map((shot) => shot.characterRequirement)
      .filter(Boolean)
      .join("；"),
  };
  return kept;
}

export function scriptRemixNextShotSettings(workspace: ScriptRemixNextWorkspace, shotId: string) {
  return { ...workspace.globalVideoSettings, ...workspace.shotVideoSettings[shotId] };
}

export function scriptRemixNextReadyToCompose(
  workspace: Pick<ScriptRemixNextWorkspace, "shots" | "composeOrder" | "selectedVideoAssetIds">,
) {
  return (
    workspace.shots.length > 0 &&
    workspace.composeOrder.length === workspace.shots.length &&
    new Set(workspace.composeOrder).size === workspace.shots.length &&
    workspace.composeOrder.every((shotId) =>
      workspace.shots.some((shot) => shot.id === shotId && Boolean(workspace.selectedVideoAssetIds[shotId])),
    )
  );
}
