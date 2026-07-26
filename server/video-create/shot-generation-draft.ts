import type { AccountStore } from "../accounts/account-store";
import type { CustomPortraitStore } from "../portraits/custom-portrait-store";
import { resolvePortraitReference } from "../portraits/portrait-resolver";
import { normalizePortraitReference } from "../../shared/portraits/portrait-reference";
import {
  buildVideoCreateShotGenerationPrompt,
  createFallbackVideoCreateShotPlan,
  fitVideoCreateShotPlanDuration,
  nextVideoCreateReferenceLabel,
  videoCreateReferenceRole,
} from "./shot-generation";
import type { VideoCreateStore } from "./video-create-store";
import { videoCreateShotNarration } from "./video-create-store";

export interface VideoCreateShotGenerationAttachment {
  source: "asset" | "portrait";
  assetId?: string;
  portraitReference?: { type: "general"; portraitId: number } | { type: "custom"; assetId: string };
  label: string;
  name: string;
  mimeType: string;
  role: "reference_image" | "reference_video" | "reference_audio";
  category?: "人物" | "商品";
  url: string;
}

export function resolveVideoCreateShotGenerationDraft(input: {
  projectId: string;
  shotId: string;
  ownerUserId: string;
  videoCreates: VideoCreateStore;
  accounts: AccountStore;
  customPortraits: CustomPortraitStore;
}) {
  const aggregate = input.videoCreates.getOwned(input.projectId, input.ownerUserId);
  const shot = aggregate?.shots.find((item) => item.id === input.shotId);
  const narration = aggregate && shot ? videoCreateShotNarration(aggregate, shot) : "";
  if (!aggregate || !shot || !narration) return undefined;
  const attachments: VideoCreateShotGenerationAttachment[] = [];
  const labels: string[] = [];
  const projectPortraitReference = normalizePortraitReference(
    aggregate.project.input.portraitReference,
    aggregate.project.input.portraitId,
  );
  const portrait = projectPortraitReference
    ? resolvePortraitReference({
        ownerUserId: input.ownerUserId,
        reference: projectPortraitReference,
        accounts: input.accounts,
        customPortraits: input.customPortraits,
      })
    : undefined;
  if (portrait) {
    const label = nextVideoCreateReferenceLabel("image", labels);
    labels.push(label);
    attachments.push({
      source: "portrait",
      portraitReference: projectPortraitReference,
      label,
      name: portrait.name,
      mimeType: portrait.mimeType,
      role: "reference_image",
      category: "人物",
      url: portrait.imageUrl,
    });
  }
  for (const productId of aggregate.project.input.productAssetIds) {
    const product = input.accounts.getOwnedAsset(input.ownerUserId, productId);
    if (!product?.mimeType.startsWith("image/")) continue;
    const label = nextVideoCreateReferenceLabel("image", labels);
    labels.push(label);
    attachments.push({
      source: "asset",
      assetId: product.id,
      label,
      name: product.displayName,
      mimeType: product.mimeType,
      role: videoCreateReferenceRole("image"),
      category: "商品",
      url: `/api/assets/${product.id}/content`,
    });
  }
  const voiceId = aggregate.project.input.voiceAssetId;
  const voice = voiceId ? input.accounts.getOwnedAsset(input.ownerUserId, voiceId) : undefined;
  if (voice?.mimeType.startsWith("audio/")) {
    const label = nextVideoCreateReferenceLabel("audio", labels);
    labels.push(label);
    attachments.push({
      source: "asset",
      assetId: voice.id,
      label,
      name: voice.displayName,
      mimeType: voice.mimeType,
      role: videoCreateReferenceRole("audio"),
      url: `/api/assets/${voice.id}/content`,
    });
  }
  const duration = Math.min(15, Math.max(4, Math.round(shot.durationSec)));
  const generationPlan = fitVideoCreateShotPlanDuration(
    shot.generationPlan ??
      createFallbackVideoCreateShotPlan({ durationSec: duration, shotPrompt: shot.prompt, narration }),
    duration,
  );
  return {
    shotId: shot.id,
    ordinal: shot.ordinal,
    narration,
    duration,
    generationPlan,
    prompt: buildVideoCreateShotGenerationPrompt({
      durationSec: duration,
      plan: generationPlan,
      references: attachments.map(({ label, name, role, category }) => ({ label, name, role, category })),
    }),
    referenceMode: "omni" as const,
    attachments,
    executionMode: "real" as const,
    postProcessAudio: { model: "tts-1" as const, voice: "alloy" as const, replacesNativeAudio: shot.audioEnabled },
  };
}
