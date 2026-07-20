import type { JobDefinition } from "./types";

export const voiceCloneDefinition: JobDefinition = {
  moduleId: "voice-clone",
  stages: [
    ["audio-validate", "样本验证"],
    ["voice-clone", "音色训练"],
    ["speech-synthesize", "试听生成"],
  ],
  summary: "音色已创建，并生成真实试听音频。",
  outputKind: () => "audio",
};
