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
  videoCreateClosingGuides,
  videoCreateContentStyles,
  videoCreateMarketingGoals,
  videoCreateMarketingMethods,
  videoCreateMaterialTopics,
  videoCreateOpeningStyles,
  videoCreatePresenterGenders,
  videoCreatePresenterRoles,
  videoCreateScriptTopics,
  videoCreateTargetAudiences,
  videoCreateTemplates,
} from "./types";
import type { VideoCreateAggregate } from "./video-create-store";

const recommendationChoices = {
  marketingGoals: videoCreateMarketingGoals,
  targetAudiences: videoCreateTargetAudiences,
  presenterRoles: videoCreatePresenterRoles,
  presenterGenders: videoCreatePresenterGenders,
  contentStyles: videoCreateContentStyles,
  openingStyles: videoCreateOpeningStyles,
  closingGuides: videoCreateClosingGuides,
  scriptTopics: videoCreateScriptTopics,
  materialTopics: videoCreateMaterialTopics,
  marketingMethods: videoCreateMarketingMethods,
  templates: videoCreateTemplates,
} as const;

const recommendationAliases: Record<string, string> = {
  销售转化: "电商转化",
  购买转化: "电商转化",
  应用下载: "App下载",
  到店转化: "门店到店",
  职场女性: "职场白领",
  上班族: "职场白领",
  年轻女性: "18-24岁女性",
  产品推荐官: "好物推荐员",
  真实用户: "普通用户",
  自然种草: "种草",
  真实体验: "种草",
  问题导向: "痛点直击",
  柔性种草: "软种草",
  功能讲解: "产品功能讲解",
  产品展示: "产品外观",
  体验分享: "使用体验",
  场景化展示: "场景展示",
};

export function normalizeVideoCreateRecommendation(value: unknown): VideoCreateRecommendation {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalized: Record<string, unknown> = { ...source };
  for (const [key, options] of Object.entries(recommendationChoices)) {
    const allowed = new Set<string>(options);
    const selected = Array.isArray(normalized[key]) ? normalized[key] : [];
    normalized[key] = [
      ...new Set(
        selected
          .filter((item): item is string => typeof item === "string")
          .map((item) => recommendationAliases[item.trim()] ?? item.trim())
          .filter((item) => allowed.has(item)),
      ),
    ];
  }
  return VideoCreateRecommendationSchema.parse(normalized);
}

export async function analyzeVideoCreateProduct(assets: MediaAsset[]): Promise<VideoCreateRecommendation> {
  const images = assets.map((asset) => ({
    path: resolve(env.dataDir, "uploads", asset.storageKey),
    mimeType: asset.mimeType,
  }));
  const result = await analyzeImagesWithGemini({
    images,
    prompt: `你是中文短视频广告策划。分析商品图片，只基于可见事实给出创作建议。严格返回 JSON：
{"productName":"","sellingPoints":[],"scene":"内容种草","durationSec":15,"segmentCount":3,"requirements":"","scriptStyle":"自然种草","marketingGoals":[],"targetAudiences":[],"audiencePainPoints":"","productBenefits":"","presenterRoles":[],"presenterGenders":[],"contentStyles":[],"openingStyles":[],"closingGuides":[],"scriptTopics":[],"materialTopics":[],"marketingMethods":[],"templates":[],"sensitiveWords":"","customRequirements":""}
sellingPoints 最多 8 条；durationSec 为 15、30、60、180 之一；segmentCount 为 1-12。多选字段只能使用下列值：
marketingGoals=电商转化/品牌曝光/App下载/门店到店/直播引流；targetAudiences=18-24岁女性/25-35岁女性/18-24岁男性/25-35岁男性/宝妈/学生/职场白领/中老年/全年龄段；presenterRoles=好物推荐员/普通用户/行业专家/品牌官方；presenterGenders=不区分/男声/女声；contentStyles=种草/专业测评/情绪共鸣/悬念叙事/故事/数据说话；openingStyles=自动匹配/痛点直击/数字冲击/福利诱惑/问句互动/品牌声量/随机；closingGuides=硬引导购买/软种草/互动提问；scriptTopics=直播带货/产品功能讲解/痛点解决/对比测评/情感共鸣/节日营销；materialTopics=产品外观/使用体验/价格优势/品质保障/售后服务/用户口碑/生活方式/成分功效/限时优惠；marketingMethods=场景展示/痛点解决/竞品对比/用户证言/专家背书/限时促销；templates=常规/节日营销/明星同款/爆款复制。无法从图片判断时返回空数组或空字符串，不要使用绝对化承诺。`,
  });
  return normalizeVideoCreateRecommendation(parseAdScriptModelJson(result.text));
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
