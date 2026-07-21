import { Video } from "@remotion/media";
import { AbsoluteFill, Sequence } from "remotion";
import { clipDuration, type VideoEditorTimeline } from "../../../shared/video-editor/timeline";

export function VideoComposition({ timeline }: { timeline: VideoEditorTimeline }) {
  let from = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {timeline.clips.map((clip) => {
        const source = timeline.sources.find((item) => item.id === clip.sourceId);
        if (!source) return null;
        const durationInFrames = Math.max(1, Math.round(clipDuration(clip) * timeline.fps));
        const sequenceFrom = from;
        from += durationInFrames;
        return (
          <Sequence key={clip.id} from={sequenceFrom} durationInFrames={durationInFrames}>
            <Video
              src={source.url}
              trimBefore={Math.round(clip.inSec * timeline.fps)}
              trimAfter={Math.round(clip.outSec * timeline.fps)}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
