export const VIDEO_EDITOR_FPS = 30;

export interface VideoEditorSource {
  id: string;
  assetId: string;
  name: string;
  url: string;
  durationSec: number;
  width: number;
  height: number;
}

export interface VideoEditorClip {
  id: string;
  sourceId: string;
  name: string;
  inSec: number;
  outSec: number;
}

export interface VideoEditorTimeline {
  version: 1;
  sources: VideoEditorSource[];
  clips: VideoEditorClip[];
  width: number;
  height: number;
  fps: number;
}

export const clipDuration = (clip: VideoEditorClip) => Math.max(0, clip.outSec - clip.inSec);
export const timelineDuration = (timeline: VideoEditorTimeline) =>
  timeline.clips.reduce((sum, clip) => sum + clipDuration(clip), 0);

export const videoEditorAssetUrl = (assetId: string) => `/api/assets/${encodeURIComponent(assetId)}/content`;

export function normalizeVideoEditorTimeline(timeline: VideoEditorTimeline): VideoEditorTimeline {
  return {
    ...timeline,
    sources: timeline.sources.map((source) => ({
      ...source,
      url: source.assetId ? videoEditorAssetUrl(source.assetId) : source.url.startsWith("blob:") ? "" : source.url,
    })),
  };
}

export function removeVideoEditorSource(timeline: VideoEditorTimeline, sourceId: string) {
  const removedClipIds = timeline.clips.filter((clip) => clip.sourceId === sourceId).map((clip) => clip.id);
  return {
    timeline: {
      ...timeline,
      sources: timeline.sources.filter((source) => source.id !== sourceId),
      clips: timeline.clips.filter((clip) => clip.sourceId !== sourceId),
    },
    removedClipIds,
  };
}

export function validateVideoEditorTimeline(timeline: VideoEditorTimeline): string | undefined {
  if (timeline.version !== 1 || timeline.fps !== VIDEO_EDITOR_FPS) return "不支持的时间线版本";
  if (!timeline.clips.length) return "时间线不能为空";
  const sources = new Map(timeline.sources.map((source) => [source.id, source]));
  for (const clip of timeline.clips) {
    const source = sources.get(clip.sourceId);
    if (!source) return "片段引用了不存在的素材";
    if (clip.inSec < 0 || clip.outSec <= clip.inSec || clip.outSec > source.durationSec + 0.01)
      return "片段时间范围无效";
  }
}
