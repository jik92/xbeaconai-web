import { Composition, registerRoot } from "remotion";
import { timelineDuration, type VideoEditorTimeline, VIDEO_EDITOR_FPS } from "../../shared/video-editor/timeline";
import { VideoComposition } from "../../web/features/video-editor/video-composition";

const fallback: VideoEditorTimeline = { version: 1, sources: [], clips: [], width: 1920, height: 1080, fps: VIDEO_EDITOR_FPS };
const RemotionRoot = () => <Composition id="VideoEditor" component={VideoComposition} width={1920} height={1080} fps={VIDEO_EDITOR_FPS} durationInFrames={1} defaultProps={{ timeline: fallback }} calculateMetadata={({ props }) => ({ width: props.timeline.width, height: props.timeline.height, fps: props.timeline.fps, durationInFrames: Math.max(1, Math.ceil(timelineDuration(props.timeline) * props.timeline.fps)) })} />;
registerRoot(RemotionRoot);
