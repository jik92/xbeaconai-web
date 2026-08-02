import type { JobRecord } from "../../server/types";
import { adScriptJob } from "./job-ad-script";
import { aiGenerateJob } from "./job-ai-generate";
import { douyinVideoImportJob } from "./job-douyin-video-import";
import { genericCreationJob } from "./job-generic-creation";
import { mediaUnderstandJob } from "./job-media-understand";
import { subtitleEraseJob, videoEnhancementJob } from "./job-mediakit-video";
import { portraitAssetRegisterJob } from "./job-portrait-asset-register";
import { qianchuanPcJob } from "./job-qianchuan-pc";
import { qwenVoiceCloneJob } from "./job-qwen-voice-clone";
import { scriptRemixNextJob } from "./job-script-remix-next";
import { videoClipMergeJob } from "./job-video-clip-merge";
import { videoCreateJob } from "./job-video-create";
import { videoCutJob } from "./job-video-cut";
import { videoEditorJob } from "./job-video-editor";
import { videoExtractJob } from "./job-video-extract";
import { videoMashupJob } from "./job-video-mashup";
import { videoRemixAnalysisJob } from "./job-video-remix-analysis";
import { videoRemixComposeJob } from "./job-video-remix-compose";
import { videoRemixPromptRewriteJob } from "./job-video-remix-prompt-rewrite";
import { videoRemixShotGenerationJob } from "./job-video-remix-shot-generation";
import { voiceCloneJob } from "./job-voice-clone";
import type { WorkerJobHandler } from "./types";

export const jobHandlers: readonly WorkerJobHandler[] = [
  douyinVideoImportJob,
  portraitAssetRegisterJob,
  qianchuanPcJob,
  adScriptJob,
  aiGenerateJob,
  mediaUnderstandJob,
  videoCreateJob,
  scriptRemixNextJob,
  videoRemixPromptRewriteJob,
  videoRemixShotGenerationJob,
  videoRemixComposeJob,
  videoRemixAnalysisJob,
  videoClipMergeJob,
  videoCutJob,
  videoExtractJob,
  videoEditorJob,
  videoMashupJob,
  qwenVoiceCloneJob,
  voiceCloneJob,
  subtitleEraseJob,
  videoEnhancementJob,
  genericCreationJob,
];

export function findJobHandler(job: JobRecord): WorkerJobHandler {
  const handler = jobHandlers.find((candidate) => candidate.supports(job));
  if (!handler) throw new Error(`没有可执行 ${job.moduleId} 的 Worker Job Handler`);
  return handler;
}
