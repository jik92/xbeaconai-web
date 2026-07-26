import { serializePortraitReference, type PortraitReference } from "../../shared/portraits/portrait-reference";
import { videoCreateVoiceSettingsKey } from "../../shared/video-create/media-settings";
import { env } from "../env";
import type { SqliteJobStore } from "../jobs/sqlite-job-store";
import type { JobRecord } from "../types";
import { VIDEO_CREATE_ANALYSIS_MODEL } from "./types";
import {
  nextVideoCreateStatus,
  VideoCreateMaterialBusyError,
  VideoCreateStateError,
  type VideoCreateStore,
  videoCreateJobValues,
} from "./video-create-store";

export interface VideoCreateQueue {
  enqueue(jobId: string): Promise<void>;
}

export interface EnqueueVideoCreateOperationInput {
  ownerUserId: string;
  projectId: string;
  operation:
    | "analyze"
    | "script"
    | "regenerate-section"
    | "storyboard"
    | "shot"
    | "audio-generate"
    | "audio-replace"
    | "subtitle-compose"
    | "compose";
  idempotencyKey?: string;
  sectionId?: string;
  shotId?: string;
  expectedVersionId?: string;
  shotOptions?: {
    videoModel: JobRecord["videoModel"];
    ratio: "9:16" | "16:9" | "1:1";
    resolution: "480p" | "720p";
    generateAudio: boolean;
    prompt?: string;
    duration?: number;
    referenceMode?: "omni";
    references?: Array<{ assetId: string; label: string; category?: "人物" | "商品" }>;
    portrait?: { reference: PortraitReference; label: string; category: "人物" } | null;
  };
}

export function videoCreateJobRecord(input: {
  ownerUserId: string;
  title: string;
  values: Record<string, string>;
  idempotencyKey?: string;
  videoModel?: JobRecord["videoModel"];
}): JobRecord {
  const timestamp = new Date().toISOString();
  const operation = input.values.operation;
  const local = operation === "compose" || operation === "audio-replace" || operation === "subtitle-compose";
  const mockVideo = false;
  return {
    id: crypto.randomUUID(),
    ownerUserId: input.ownerUserId,
    moduleId: "video-create",
    title: input.title,
    status: "queued",
    progress: 0,
    stage: "排队中",
    overallExecutionMode: mockVideo ? "mock" : local ? "local" : "real",
    values: input.values,
    videoModel: input.videoModel,
    executionPlan: [
      {
        id: `plan:0:${operation}`,
        capability: operation,
        executionMode: mockVideo ? "mock" : local ? "local" : "real",
        implementation: mockVideo
          ? "ffmpeg-seedance-mock"
          : local
            ? operation === "audio-replace"
              ? "ffmpeg-audio-replace"
              : operation === "subtitle-compose"
                ? "ffmpeg-subtitle"
                : "ffmpeg-concat"
            : operation === "analyze"
              ? "aihubmix-gpt-image-analysis"
              : operation === "shot"
                ? "ark-seedance-video"
                : operation === "audio-generate"
                  ? "volc-tts-v3-unidirectional"
                  : "aihubmix-text",
        provider:
          local || mockVideo
            ? undefined
            : operation === "shot"
              ? "ark"
              : operation === "audio-generate"
                ? "volc-speech"
                : "aihubmix",
        model: mockVideo
          ? undefined
          : operation === "analyze"
            ? VIDEO_CREATE_ANALYSIS_MODEL
            : operation === "shot"
              ? input.videoModel
              : operation === "audio-generate"
                ? env.volcSpeech.presetTtsResourceId
                : local
                  ? undefined
                  : "deepseek-v4-pro",
        startedAt: "",
      },
    ],
    provenance: [],
    idempotencyKey: input.idempotencyKey,
    cancelRequested: false,
    providerCancelState: "none",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function enqueueVideoCreateOperation(
  dependencies: { store: SqliteJobStore; videoCreates: VideoCreateStore; queue: VideoCreateQueue },
  input: EnqueueVideoCreateOperationInput,
) {
  const { store, videoCreates, queue } = dependencies;
  if (input.idempotencyKey) {
    const existing = store.getByIdempotencyKey(input.ownerUserId, input.idempotencyKey);
    if (existing) return existing;
  }
  const aggregate = videoCreates.getOwned(input.projectId, input.ownerUserId);
  if (!aggregate) throw new VideoCreateStateError("一键成片项目不存在");
  const shot = input.shotId ? aggregate.shots.find((item) => item.id === input.shotId) : undefined;
  if (shot && (shot.status === "queued" || shot.status === "generating" || shot.materialProcessing))
    throw new VideoCreateMaterialBusyError("该分镜正在处理中");
  const referenceId = aggregate.project.input.productAssetIds[0];
  const explicitReferences = input.shotOptions?.references;
  const explicitPortrait = input.shotOptions?.portrait;
  const explicitPortraitValues = explicitPortrait
    ? (() => {
        const portraitReference = serializePortraitReference(explicitPortrait.reference);
        if (!portraitReference) throw new VideoCreateStateError("人像参考信息无效");
        return { portraitReference, portraitLabel: explicitPortrait.label };
      })()
    : undefined;
  const materialInputVersionId =
    shot?.currentMaterialVersionId && input.operation === "subtitle-compose"
      ? (videoCreates.getSubtitleSourceMaterialVersion(input.projectId, shot.id, shot.currentMaterialVersionId)?.id ??
        shot.currentMaterialVersionId)
      : shot?.currentMaterialVersionId;
  const values = {
    ...videoCreateJobValues(input),
    ...(shot
      ? {
          previousShotStatus: shot.status,
          ...(materialInputVersionId ? { inputMaterialVersionId: materialInputVersionId } : {}),
          ...(shot.currentMaterialVersionId && materialInputVersionId !== shot.currentMaterialVersionId
            ? { expectedCurrentMaterialVersionId: shot.currentMaterialVersionId }
            : {}),
        }
      : {}),
    ...(shot
      ? {
          prompt: input.shotOptions?.prompt ?? shot.prompt,
          durationSec: String(input.shotOptions?.duration ?? shot.durationSec),
          ratio: input.shotOptions?.ratio ?? aggregate.project.input.ratio,
          resolution: input.shotOptions?.resolution ?? "720p",
          generateAudio: String(input.shotOptions?.generateAudio ?? shot.audioEnabled),
          subtitleEnabled: String(shot.subtitleEnabled),
          voicePresetId: aggregate.project.input.voiceSettings.presetVoiceId,
          voiceSpeed: aggregate.project.input.voiceSettings.speed,
          voiceStyle: aggregate.project.input.voiceSettings.style,
          voiceSettingsKey: videoCreateVoiceSettingsKey(aggregate.project.input.voiceSettings),
          subtitleStyleId: aggregate.project.input.subtitleStyleId,
          ...(input.shotOptions?.referenceMode ? { referenceMode: input.shotOptions.referenceMode } : {}),
          ...(explicitReferences
            ? {
                references: `assets:${JSON.stringify(
                  explicitReferences.map((reference) => ({ id: reference.assetId, label: reference.label })),
                )}`,
              }
            : aggregate.project.input.voiceAssetId
              ? { voiceReference: `asset:${aggregate.project.input.voiceAssetId}:voice` }
              : {}),
          ...(explicitPortrait !== undefined
            ? (explicitPortraitValues ?? {})
            : referenceId
              ? { reference: `asset:${referenceId}:reference` }
              : {}),
        }
      : {}),
  };
  const job = videoCreateJobRecord({
    ownerUserId: input.ownerUserId,
    title: `${aggregate.project.title} · ${input.operation}`,
    values,
    idempotencyKey: input.idempotencyKey,
    videoModel:
      input.operation === "shot" ? (input.shotOptions?.videoModel ?? aggregate.project.input.videoModel) : undefined,
  });
  const persisted = store.createIdempotent(job);
  if (!persisted.created) return persisted.job;
  if (shot && input.operation !== "audio-generate") {
    const source =
      input.operation === "audio-replace"
        ? "audio_replaced"
        : input.operation === "subtitle-compose"
          ? "subtitle_composed"
          : "ai_generated";
    videoCreates.createPendingMaterialVersion({
      projectId: input.projectId,
      shotId: shot.id,
      source,
      inputVersionId: materialInputVersionId,
      jobId: job.id,
      subtitlesComposed:
        input.operation === "subtitle-compose"
          ? true
          : input.operation === "audio-replace" && shot.currentMaterialVersionId
            ? (videoCreates.getMaterialVersion(input.projectId, shot.id, shot.currentMaterialVersionId)
                ?.subtitlesComposed ?? false)
            : false,
      subtitleStyleId:
        input.operation === "subtitle-compose"
          ? aggregate.project.input.subtitleStyleId
          : input.operation === "audio-replace" && shot.currentMaterialVersionId
            ? (videoCreates.getMaterialVersion(input.projectId, shot.id, shot.currentMaterialVersionId)
                ?.subtitleStyleId ?? null)
            : input.operation === "shot" && shot.subtitleEnabled
              ? aggregate.project.input.subtitleStyleId
              : null,
    });
    videoCreates.updateShot(shot.id, {
      ...(input.operation === "shot" && !shot.currentMaterialVersionId ? { status: "queued" as const } : {}),
      ...(input.operation === "shot" && input.shotOptions ? { audioEnabled: !input.shotOptions.generateAudio } : {}),
      jobId: job.id,
      error: null,
    });
  } else if (shot) {
    videoCreates.updateShot(shot.id, {
      status: "queued",
      ...(input.operation === "audio-generate" ? { audioEnabled: true } : {}),
      jobId: job.id,
      error: null,
    });
  } else {
    videoCreates.setProject(input.projectId, {
      status: nextVideoCreateStatus(input.operation),
      currentJobId: job.id,
      error: null,
    });
  }
  await queue.enqueue(job.id);
  return job;
}
