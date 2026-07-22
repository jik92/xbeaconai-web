import { z } from "@hono/zod-openapi";
import { seedanceModelIds } from "../models/video-models";

export const videoCreateMarketingGoals = ["电商转化", "品牌曝光", "App下载", "门店到店", "直播引流"] as const;
export const videoCreateTargetAudiences = [
  "18-24岁女性",
  "25-35岁女性",
  "18-24岁男性",
  "25-35岁男性",
  "宝妈",
  "学生",
  "职场白领",
  "中老年",
  "全年龄段",
] as const;
export const videoCreatePresenterRoles = ["好物推荐员", "普通用户", "行业专家", "品牌官方"] as const;
export const videoCreatePresenterGenders = ["不区分", "男声", "女声"] as const;
export const videoCreateContentStyles = ["种草", "专业测评", "情绪共鸣", "悬念叙事", "故事", "数据说话"] as const;
export const videoCreateOpeningStyles = [
  "自动匹配",
  "痛点直击",
  "数字冲击",
  "福利诱惑",
  "问句互动",
  "品牌声量",
  "随机",
] as const;
export const videoCreateClosingGuides = ["硬引导购买", "软种草", "互动提问"] as const;
export const videoCreateScriptTopics = [
  "直播带货",
  "产品功能讲解",
  "痛点解决",
  "对比测评",
  "情感共鸣",
  "节日营销",
] as const;
export const videoCreateMaterialTopics = [
  "产品外观",
  "使用体验",
  "价格优势",
  "品质保障",
  "售后服务",
  "用户口碑",
  "生活方式",
  "成分功效",
  "限时优惠",
] as const;
export const videoCreateMarketingMethods = [
  "场景展示",
  "痛点解决",
  "竞品对比",
  "用户证言",
  "专家背书",
  "限时促销",
] as const;
export const videoCreateTemplates = ["常规", "节日营销", "明星同款", "爆款复制"] as const;

const selectableArray = <T extends readonly [string, ...string[]]>(values: T) =>
  z.array(z.enum(values)).max(values.length).default([]);

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

export const VideoCreateSubtitleCueSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  text: z.string().trim().min(1).max(200),
});

export const VideoCreateInputSchema = z
  .object({
    productAssetIds: z.array(z.string().uuid()).min(1).max(6),
    portraitId: z.number().int().min(1).optional(),
    scene: z.string().trim().min(1).max(40),
    productName: z.string().trim().max(60).default(""),
    sellingPoints: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
    durationSec: z.number().int().min(15).max(180),
    segmentCount: z.number().int().min(1).max(12),
    speechRate: z.enum(["slow", "medium", "fast"]),
    requirements: z.string().trim().max(1_000).default(""),
    scriptStyle: z.string().trim().max(100).default("自然种草"),
    marketingGoals: selectableArray(videoCreateMarketingGoals),
    targetAudiences: selectableArray(videoCreateTargetAudiences),
    audiencePainPoints: z.string().trim().max(500).default(""),
    productBenefits: z.string().trim().max(500).default(""),
    presenterRoles: selectableArray(videoCreatePresenterRoles),
    presenterGenders: selectableArray(videoCreatePresenterGenders),
    contentStyles: selectableArray(videoCreateContentStyles),
    openingStyles: selectableArray(videoCreateOpeningStyles),
    closingGuides: selectableArray(videoCreateClosingGuides),
    scriptTopics: selectableArray(videoCreateScriptTopics),
    materialTopics: selectableArray(videoCreateMaterialTopics),
    marketingMethods: selectableArray(videoCreateMarketingMethods),
    templates: selectableArray(videoCreateTemplates),
    sensitiveWords: z.string().trim().max(500).default(""),
    customRequirements: z.string().trim().max(1_000).default(""),
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
    speechRate: z.enum(["slow", "medium", "fast"]).default("medium"),
    requirements: z.string().trim().max(1_000),
    scriptStyle: z.string().trim().min(1).max(100),
    marketingGoals: selectableArray(videoCreateMarketingGoals),
    targetAudiences: selectableArray(videoCreateTargetAudiences),
    audiencePainPoints: z.string().trim().max(500).default(""),
    productBenefits: z.string().trim().max(500).default(""),
    presenterRoles: selectableArray(videoCreatePresenterRoles),
    presenterGenders: selectableArray(videoCreatePresenterGenders),
    contentStyles: selectableArray(videoCreateContentStyles),
    openingStyles: selectableArray(videoCreateOpeningStyles),
    closingGuides: selectableArray(videoCreateClosingGuides),
    scriptTopics: selectableArray(videoCreateScriptTopics),
    materialTopics: selectableArray(videoCreateMaterialTopics),
    marketingMethods: selectableArray(videoCreateMarketingMethods),
    templates: selectableArray(videoCreateTemplates),
    sensitiveWords: z.string().trim().max(500).default(""),
    customRequirements: z.string().trim().max(1_000).default(""),
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
export type VideoCreateSubtitleCue = z.infer<typeof VideoCreateSubtitleCueSchema>;
export type VideoCreateInput = z.infer<typeof VideoCreateInputSchema>;
export type VideoCreateRecommendation = z.infer<typeof VideoCreateRecommendationSchema>;
export type VideoCreateGeneratedScript = z.infer<typeof VideoCreateGeneratedScriptSchema>;
export type VideoCreateGeneratedStoryboard = z.infer<typeof VideoCreateGeneratedStoryboardSchema>;

export const VIDEO_CREATE_TEXT_MODEL = "deepseek-v4-pro";
export const VIDEO_CREATE_ANALYSIS_MODEL = "gpt-5.4-mini";
