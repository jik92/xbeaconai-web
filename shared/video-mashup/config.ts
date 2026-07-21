export type MashupCombinationMode = "max-results" | "max-difference";
export type MashupResolution = "720P" | "1080P";

export interface MashupGroup {
  id: string;
  name: string;
  assetIds: string[];
}

export interface VideoMashupConfig {
  version: 1;
  groups: MashupGroup[];
  combinationMode: MashupCombinationMode;
  resolution: MashupResolution;
  count: number;
  outputFolderId: string;
}

export interface MashupCombination {
  key: string;
  assetIds: string[];
}

const MAX_CANDIDATES = 20_000;

export function theoreticalCombinationCount(groups: ReadonlyArray<Pick<MashupGroup, "assetIds">>) {
  return groups.reduce((total, group) => Math.min(Number.MAX_SAFE_INTEGER, total * group.assetIds.length), 1);
}

export function validateVideoMashupConfig(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return "混剪配置格式无效";
  const config = value as Partial<VideoMashupConfig>;
  if (config.version !== 1) return "不支持的混剪配置版本";
  if (!Array.isArray(config.groups) || config.groups.length < 2 || config.groups.length > 10)
    return "视频组数量必须为 2–10 组";
  for (const [index, group] of config.groups.entries()) {
    if (!group || typeof group.id !== "string" || typeof group.name !== "string") return `视频组 ${index + 1} 格式无效`;
    if (!Array.isArray(group.assetIds) || group.assetIds.length < 1 || group.assetIds.length > 20)
      return `视频组 ${index + 1} 必须选择 1–20 个视频`;
    if (group.assetIds.some((id) => typeof id !== "string" || !id)) return `视频组 ${index + 1} 包含无效素材`;
    if (new Set(group.assetIds).size !== group.assetIds.length) return `视频组 ${index + 1} 包含重复素材`;
  }
  if (config.combinationMode !== "max-results" && config.combinationMode !== "max-difference") return "组合模式无效";
  if (config.resolution !== "720P" && config.resolution !== "1080P") return "输出分辨率无效";
  if (!Number.isInteger(config.count) || (config.count ?? 0) < 1 || (config.count ?? 0) > 20)
    return "生成数量必须为 1–20";
  if (typeof config.outputFolderId !== "string" || !config.outputFolderId) return "请选择保存位置";
  if ((config.count ?? 0) > theoreticalCombinationCount(config.groups)) return "生成数量不能超过理论组合数";
}

function lexicalCombinations(groups: ReadonlyArray<Pick<MashupGroup, "assetIds">>, limit: number) {
  const results: MashupCombination[] = [];
  const visit = (groupIndex: number, assetIds: string[]) => {
    if (results.length >= limit) return;
    if (groupIndex === groups.length) {
      results.push({ key: assetIds.join("|"), assetIds: [...assetIds] });
      return;
    }
    for (const assetId of groups[groupIndex]?.assetIds ?? []) {
      assetIds.push(assetId);
      visit(groupIndex + 1, assetIds);
      assetIds.pop();
      if (results.length >= limit) return;
    }
  };
  visit(0, []);
  return results;
}

const hammingDistance = (left: MashupCombination, right: MashupCombination) =>
  left.assetIds.reduce((distance, assetId, index) => distance + Number(assetId !== right.assetIds[index]), 0);

export function planMashupCombinations(config: VideoMashupConfig): MashupCombination[] {
  if (config.combinationMode === "max-results") return lexicalCombinations(config.groups, config.count);
  const candidates = lexicalCombinations(
    config.groups,
    Math.min(MAX_CANDIDATES, theoreticalCombinationCount(config.groups)),
  );
  if (!candidates.length) return [];
  const first = candidates.shift();
  if (!first) return [];
  const selected = [first];
  const usage = new Map(first.assetIds.map((id) => [id, 1]));
  while (selected.length < config.count && candidates.length) {
    let bestIndex = 0;
    let bestDistance = -1;
    let bestUsage = Number.POSITIVE_INFINITY;
    for (const [index, candidate] of candidates.entries()) {
      const distance = Math.min(...selected.map((chosen) => hammingDistance(candidate, chosen)));
      const candidateUsage = candidate.assetIds.reduce((sum, id) => sum + (usage.get(id) ?? 0), 0);
      if (distance > bestDistance || (distance === bestDistance && candidateUsage < bestUsage)) {
        bestIndex = index;
        bestDistance = distance;
        bestUsage = candidateUsage;
      }
    }
    const [best] = candidates.splice(bestIndex, 1);
    if (!best) break;
    selected.push(best);
    for (const id of best.assetIds) usage.set(id, (usage.get(id) ?? 0) + 1);
  }
  return selected;
}

export function parseVideoMashupConfig(value: string): VideoMashupConfig {
  let config: unknown;
  try {
    config = JSON.parse(value);
  } catch {
    throw new Error("混剪配置不是有效 JSON");
  }
  const invalid = validateVideoMashupConfig(config);
  if (invalid) throw new Error(invalid);
  return config as VideoMashupConfig;
}
