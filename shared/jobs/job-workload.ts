export type JobWorkload = "network" | "ffmpeg";

export interface JobWorkloadDescriptor {
  moduleId: string;
  values: Record<string, string>;
  executionPlan?: ReadonlyArray<{ implementation: string }>;
}

const ffmpegModules = new Set(["video-cut", "video-mashup", "video-editor", "kickart", "video-renewal"]);
const ffmpegVideoCreateOperations = new Set(["audio-replace", "subtitle-compose", "compose"]);

/**
 * Classifies the whole persisted job before it enters BullMQ.
 * `ffprobe`-only validation deliberately stays in the network pool.
 */
export function classifyJobWorkload(job: JobWorkloadDescriptor): JobWorkload {
  if (job.executionPlan?.some((stage) => stage.implementation.startsWith("ffmpeg-"))) return "ffmpeg";
  if (ffmpegModules.has(job.moduleId)) return "ffmpeg";
  if (job.moduleId === "video-remix")
    return job.values.workflowPhase === "analysis" || job.values.workflowPhase === "compose" ? "ffmpeg" : "network";
  if (job.moduleId === "video-create") {
    if (ffmpegVideoCreateOperations.has(job.values.operation)) return "ffmpeg";
    if (job.values.operation === "shot")
      return job.values.subtitleEnabled !== "false" ||
        job.values.__mockVideo === "true" ||
        job.values.__mockAudio === "true"
        ? "ffmpeg"
        : "network";
    if (job.values.operation === "audio-generate" && job.values.__mockAudio === "true") return "ffmpeg";
  }
  return "network";
}
