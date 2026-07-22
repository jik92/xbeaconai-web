import { parseRemixWorkspace, type RemixProjectStage } from "../../shared/video-remix/project-records";
import { parseRemixAnalysisEntries, parseRemixSources } from "../../shared/video-remix/workflow";
import type { JobRecord } from "../types";

export interface RemixProjectSummary {
  id: string;
  title: string;
  productName: string;
  currentStage: RemixProjectStage;
  status: JobRecord["status"];
  sourceCount: number;
  generatedCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const workspaceStages: RemixProjectStage[] = ["upload", "analysis", "prompt", "storyboard", "compose"];

export function summarizeRemixProject(root: JobRecord, children: JobRecord[], createdBy: string): RemixProjectSummary {
  const sources = parseRemixSources(root.values.sources);
  const analysisEntries = parseRemixAnalysisEntries(root.values.analysisEntries);
  const workspace = parseRemixWorkspace(
    root.values.workspaceState,
    sources.map((source) => source.assetId),
    analysisEntries,
  );
  const shotJobs = children.filter((job) => job.values.workflowPhase === "shot-generation");
  const composeJobs = children.filter((job) => job.values.workflowPhase === "compose");
  const latestCompose = [...composeJobs].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const activeChild = children.find((job) => job.status === "processing" || job.status === "queued");
  const generatedSources = new Set(
    shotJobs
      .filter((job) => job.status === "succeeded" && job.values.sourceAssetId)
      .map((job) => job.values.sourceAssetId as string),
  );
  let currentStage: RemixProjectStage = workspaceStages[workspace.stage] ?? "upload";
  let status = root.status;
  if (root.status === "failed" || root.status === "cancelled") currentStage = "failed";
  else if (root.status === "queued" || root.status === "processing") currentStage = "analysis";
  else if (latestCompose?.status === "succeeded") {
    currentStage = "completed";
    status = "succeeded";
  } else if (latestCompose) {
    currentStage = "compose";
    status = latestCompose.status;
  } else if (shotJobs.length && workspace.stage < 3) currentStage = "storyboard";
  if (activeChild && currentStage !== "completed") status = activeChild.status;
  const updatedAt =
    [root, ...children].map((job) => job.updatedAt).sort((left, right) => right.localeCompare(left))[0] ??
    root.updatedAt;
  return {
    id: root.id,
    title: root.title,
    productName: root.values.productName || "未命名商品",
    currentStage,
    status,
    sourceCount: sources.length,
    generatedCount: generatedSources.size,
    createdBy,
    createdAt: root.createdAt,
    updatedAt,
  };
}

export function groupRemixChildren(children: JobRecord[]) {
  const grouped = new Map<string, JobRecord[]>();
  for (const child of children) {
    if (!child.parentJobId) continue;
    const group = grouped.get(child.parentJobId) ?? [];
    group.push(child);
    grouped.set(child.parentJobId, group);
  }
  return grouped;
}
