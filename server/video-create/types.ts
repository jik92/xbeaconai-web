import { z } from "@hono/zod-openapi";
import { seedanceModelIds } from "../models/video-models";

export const VideoCreateProjectStatusSchema = z.enum([
  "draft",
  "analyzing",
  "script_generating",
  "script_review",
  "storyboard_generating",
  "storyboard_review",
  "composing",
  "completed",
  "failed",
]);

export const VideoCreateShotStatusSchema = z.enum([
  "pending",
  "queued",
  "generating",
  "succeeded",
  "failed",
  "replaced",
]);

export const VideoCreateInputSchema = z
  .object({
    productAssetIds: z.array(z.string().uuid()).min(1).max(6),
    portraitAssetId: z.string().uuid().optional(),
    scene: z.string().trim().min(1).max(40),
    productName: z.string().trim().max(60).default(""),
    sellingPoints: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
    durationSec: z.number().int().min(15).max(180),
    segmentCount: z.number().int().min(1).max(12),
    speechRate: z.enum(["slow", "medium", "fast"]),
    requirements: z.string().trim().max(1_000).default(""),
    scriptStyle: z.string().trim().max(100).default("自然种草"),
    videoModel: z.enum(seedanceModelIds).default("doubao-seedance-2-0-fast-260128"),
    voiceAssetId: z.string().uuid().optional(),
    ratio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
    subtitles: z.boolean().default(true),
    priority: z.enum(["speech", "visual"]).default("speech"),
  })
  .openapi("VideoCreateInput");

export const VideoCreateRecommendationSchema = z
  .object({
    productName: z.string().trim().min(1).max(60),
    sellingPoints: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
    scene: z.string().trim().min(1).max(40),
    durationSec: z.number().int().min(15).max(180),
    segmentCount: z.number().int().min(1).max(12),
    requirements: z.string().trim().max(1_000),
    scriptStyle: z.string().trim().min(1).max(100),
  })
  .openapi("VideoCreateRecommendation");

export const VideoCreateGeneratedScriptSchema = z.object({
  sections: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(20),
        text: z.string().trim().min(1).max(1_000),
        durationSec: z.number().int().min(1).max(180),
      }),
    )
    .min(1)
    .max(12),
});

export const VideoCreateGeneratedStoryboardSchema = z.object({
  shots: z
    .array(
      z.object({
        prompt: z.string().trim().min(10).max(2_000),
        durationSec: z.number().int().min(1).max(15),
      }),
    )
    .min(1)
    .max(12),
});

export type VideoCreateProjectStatus = z.infer<typeof VideoCreateProjectStatusSchema>;
export type VideoCreateShotStatus = z.infer<typeof VideoCreateShotStatusSchema>;
export type VideoCreateInput = z.infer<typeof VideoCreateInputSchema>;
export type VideoCreateRecommendation = z.infer<typeof VideoCreateRecommendationSchema>;
export type VideoCreateGeneratedScript = z.infer<typeof VideoCreateGeneratedScriptSchema>;
export type VideoCreateGeneratedStoryboard = z.infer<typeof VideoCreateGeneratedStoryboardSchema>;

export const VIDEO_CREATE_TEXT_MODEL = "deepseek-v4-pro";
