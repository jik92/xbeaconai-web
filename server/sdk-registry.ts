export type SdkKind = "model" | "ffmpeg" | "mock";

export interface SdkRegistryEntry {
  id: string;
  implementationPath: string;
  kind: SdkKind;
  capability: string;
  provider?: string;
  model?: string;
  requiredFeature?: string;
  enabled: boolean;
  required: boolean;
  testAdapter: string;
}

export const sdkRegistry: SdkRegistryEntry[] = [
  {
    id: "aihubmix-text",
    implementationPath: "server/providers/aihubmix.ts",
    kind: "model",
    capability: "text-generate",
    provider: "aihubmix",
    model: "gpt-4.1-nano-free",
    enabled: true,
    required: true,
    testAdapter: "test-text",
  },
  {
    id: "aihubmix-image",
    implementationPath: "server/providers/aihubmix.ts",
    kind: "model",
    capability: "image-generate",
    provider: "aihubmix",
    model: "gpt-image-1-mini",
    enabled: true,
    required: true,
    testAdapter: "test-image",
  },
  {
    id: "aihubmix-audio",
    implementationPath: "server/providers/aihubmix.ts",
    kind: "model",
    capability: "audio-generate",
    provider: "aihubmix",
    model: "tts-1",
    enabled: true,
    required: true,
    testAdapter: "test-audio",
  },
  {
    id: "aihubmix-seedance-standard",
    implementationPath: "server/providers/aihubmix.ts",
    kind: "model",
    capability: "video-generate",
    provider: "aihubmix",
    model: "doubao-seedance-2-0-260128",
    enabled: true,
    required: true,
    testAdapter: "test-video",
  },
  {
    id: "aihubmix-seedance-mini",
    implementationPath: "server/providers/aihubmix.ts",
    kind: "model",
    capability: "video-generate",
    provider: "aihubmix",
    model: "doubao-seedance-2-0-mini-260615",
    enabled: true,
    required: true,
    testAdapter: "test-video",
  },
  {
    id: "aihubmix-seedance-fast",
    implementationPath: "server/providers/aihubmix.ts",
    kind: "model",
    capability: "video-generate",
    provider: "aihubmix",
    model: "doubao-seedance-2-0-fast-260128",
    enabled: true,
    required: true,
    testAdapter: "test-video",
  },
  {
    id: "ffmpeg-sample",
    implementationPath: "server/media/ffmpeg.ts",
    kind: "ffmpeg",
    capability: "sample-generate",
    requiredFeature: "lavfi",
    enabled: true,
    required: true,
    testAdapter: "test-sample",
  },
  {
    id: "ffmpeg-probe",
    implementationPath: "server/media/ffmpeg.ts",
    kind: "ffmpeg",
    capability: "media-probe",
    requiredFeature: "ffprobe",
    enabled: true,
    required: true,
    testAdapter: "test-probe",
  },
  {
    id: "ffmpeg-transcode",
    implementationPath: "server/media/ffmpeg.ts",
    kind: "ffmpeg",
    capability: "transcode",
    requiredFeature: "libx264",
    enabled: true,
    required: true,
    testAdapter: "test-transcode",
  },
  {
    id: "ffmpeg-frame",
    implementationPath: "server/media/ffmpeg.ts",
    kind: "ffmpeg",
    capability: "frame-extract",
    requiredFeature: "image2",
    enabled: true,
    required: true,
    testAdapter: "test-frame",
  },
  {
    id: "ffmpeg-audio",
    implementationPath: "server/media/ffmpeg.ts",
    kind: "ffmpeg",
    capability: "audio-extract",
    requiredFeature: "pcm_s16le",
    enabled: true,
    required: true,
    testAdapter: "test-audio-extract",
  },
  {
    id: "ffmpeg-split",
    implementationPath: "server/media/ffmpeg.ts",
    kind: "ffmpeg",
    capability: "fixed-split",
    requiredFeature: "segment",
    enabled: true,
    required: true,
    testAdapter: "test-split",
  },
  {
    id: "ffmpeg-compose",
    implementationPath: "server/media/ffmpeg.ts",
    kind: "ffmpeg",
    capability: "media-compose",
    requiredFeature: "libx264,aac",
    enabled: true,
    required: true,
    testAdapter: "test-compose",
  },
  {
    id: "ffmpeg-subtitle",
    implementationPath: "server/media/ffmpeg.ts",
    kind: "ffmpeg",
    capability: "subtitle-burn",
    requiredFeature: "drawtext",
    enabled: true,
    required: true,
    testAdapter: "test-subtitle",
  },
  {
    id: "ffmpeg-denoise",
    implementationPath: "server/media/ffmpeg.ts",
    kind: "ffmpeg",
    capability: "video-denoise",
    requiredFeature: "hqdn3d",
    enabled: true,
    required: true,
    testAdapter: "test-denoise",
  },
  {
    id: "mock-multimodal",
    implementationPath: "worker/job-processor.ts",
    kind: "mock",
    capability: "fallback-all",
    provider: "yaozuo-mock",
    enabled: true,
    required: true,
    testAdapter: "test-mock-workflows",
  },
];

export function auditSdkRegistry() {
  const ids = new Set<string>();
  for (const entry of sdkRegistry) {
    if (ids.has(entry.id)) throw new Error(`Duplicate SDK registry id: ${entry.id}`);
    ids.add(entry.id);
    if (!entry.implementationPath || !entry.testAdapter) throw new Error(`Incomplete SDK registry entry: ${entry.id}`);
  }
  return sdkRegistry.filter((entry) => entry.enabled);
}
