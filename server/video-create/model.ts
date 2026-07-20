import { resolve } from "node:path";
import type { MediaAsset } from "../accounts/account-store";
import { generateStructured, parseAdScriptModelJson } from "../ad-script/model";
import { env } from "../env";
import { analyzeImagesWithGemini } from "../providers/gemini-video-analysis";
import {
  type VideoCreateGeneratedScript,
  VideoCreateGeneratedScriptSchema,
  type VideoCreateGeneratedStoryboard,
  VideoCreateGeneratedStoryboardSchema,
  type VideoCreateRecommendation,
  VideoCreateRecommendationSchema,
} from "./types";
import type { VideoCreateAggregate } from "./video-create-store";

export async function analyzeVideoCreateProduct(assets: MediaAsset[]): Promise<VideoCreateRecommendation> {
  const images = assets.map((asset) => ({
    path: resolve(env.dataDir, "uploads", asset.storageKey),
    mimeType: asset.mimeType,
  }));
  const result = await analyzeImagesWithGemini({
    images,
    prompt: `你是中文短视频广告策划。分析商品图片，只基于可见事实给出创作建议。严格返回 JSON：
{"productName":"","sellingPoints":[],"scene":"内容种草","durationSec":15,"segmentCount":3,"requirements":"","scriptStyle":"自然种草"}
sellingPoints 最多 8 条；durationSec 为 15、30、60、180 之一；segmentCount 为 1-12。不要使用绝对化承诺。`,
  });
  return VideoCreateRecommendationSchema.parse(parseAdScriptModelJson(result.text));
}

export function generateVideoCreateScript(aggregate: VideoCreateAggregate): Promise<VideoCreateGeneratedScript> {
  const input = aggregate.project.input;
  return generateStructured(
    `你是专业中文短视频广告编导。为商品生成可直接配音的分段脚本。严格返回 JSON：
{"sections":[{"label":"开场共鸣","text":"","durationSec":3}]}
必须恰好 ${input.segmentCount} 段，总时长尽量为 ${input.durationSec} 秒；根据语速 ${input.speechRate} 控制字数；每段衔接自然，突出真实卖点并避免夸大承诺。
业务参数：${JSON.stringify(input)}`,
    VideoCreateGeneratedScriptSchema,
    { maxTokens: 3_000 },
  );
}

export function regenerateVideoCreateSection(
  aggregate: VideoCreateAggregate,
  sectionId: string,
): Promise<VideoCreateGeneratedScript["sections"][number]> {
  const section = aggregate.sections.find((item) => item.id === sectionId);
  if (!section?.currentVersion) throw new Error("SCRIPT_SECTION_NOT_FOUND");
  return generateStructured(
    `你是中文短视频广告编导。改写指定段落，保持用途和时长，只返回 JSON：
{"label":"${section.label}","text":"","durationSec":${section.currentVersion.durationSec}}
项目参数：${JSON.stringify(aggregate.project.input)}
当前段落：${section.currentVersion.text}`,
    VideoCreateGeneratedScriptSchema.shape.sections.element,
    { maxTokens: 1_000 },
  );
}

export function generateVideoCreateStoryboard(
  aggregate: VideoCreateAggregate,
): Promise<VideoCreateGeneratedStoryboard> {
  const sections = aggregate.sections.map((section) => ({
    label: section.label,
    text: section.currentVersion?.text,
    durationSec: section.currentVersion?.durationSec,
  }));
  return generateStructured(
    `你是短视频分镜导演。根据商品信息和逐段口播，为每段生成一个可直接提交视频模型的中文画面提示词。严格返回 JSON：
{"shots":[{"prompt":"","durationSec":5}]}
必须恰好 ${sections.length} 个镜头，顺序与脚本一致；单镜头 4-15 秒；提示词包含主体、动作、场景、景别、运镜、光线、画幅和商品一致性要求，不要在画面中生成文字。
项目参数：${JSON.stringify(aggregate.project.input)}
脚本：${JSON.stringify(sections)}`,
    VideoCreateGeneratedStoryboardSchema,
    { maxTokens: 4_000 },
  );
}
