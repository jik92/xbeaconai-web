import type { JobModuleId } from "../../../server/types";
import { adScriptDefinition } from "./ad-script";
import { aiGenerateDefinition } from "./ai-generate";
import { kickartDefinition } from "./kickart";
import { mediaUnderstandDefinition } from "./media-understand";
import { subtitleEraseDefinition } from "./subtitle-erase";
import type { JobDefinition } from "./types";
import { videoCreateDefinition } from "./video-create";
import { videoCutDefinition } from "./video-cut";
import { videoEnhancementDefinition } from "./video-enhancement";
import { videoMashupDefinition } from "./video-mashup";
import { videoRemixDefinition } from "./video-remix";
import { videoRenewalDefinition } from "./video-renewal";
import { voiceCloneDefinition } from "./voice-clone";

const definitions = [
  videoRemixDefinition,
  videoCreateDefinition,
  adScriptDefinition,
  aiGenerateDefinition,
  videoCutDefinition,
  mediaUnderstandDefinition,
  videoMashupDefinition,
  voiceCloneDefinition,
  videoRenewalDefinition,
  subtitleEraseDefinition,
  videoEnhancementDefinition,
  kickartDefinition,
];

export const jobDefinitions: Partial<Record<JobModuleId, JobDefinition>> = Object.fromEntries(
  definitions.map((definition) => [definition.moduleId, definition]),
);
