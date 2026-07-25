import { formatPortraitIdentity, parsePortraitTags } from "../../shared/portraits/portrait-tags";
import type { MediaAsset } from "../accounts/account-store";
import { generateStructured, parseAdScriptModelJson } from "../ad-script/model";
import { getPortraitById } from "../portraits/catalog";
import { aihubmix } from "../providers/aihubmix";
import { ossutils } from "../storage/ossutils";
import {
  VIDEO_CREATE_ANALYSIS_MODEL,
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

export function videoCreateTargetCharacterCount(
  durationSec: number,
  speechRate: VideoCreateRecommendation["speechRate"],
) {
  const charactersPerSecond = speechRate === "slow" ? 3 : speechRate === "fast" ? 5 : 4;
  return durationSec * charactersPerSecond;
}

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

async function responseImage(url: string, missingCode: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${missingCode}:${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error(missingCode);
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("IMAGE_ANALYSIS_IMAGE_TOO_LARGE");
  return { bytes, mimeType: response.headers.get("content-type")?.split(";", 1)[0] || "image/png" };
}

async function productImage(asset: MediaAsset) {
  if (!ossutils.configured) throw new Error("PRODUCT_REFERENCE_FILE_NOT_FOUND");
  return responseImage(ossutils.createSignedReadUrl(asset.storageKey), "PRODUCT_REFERENCE_DOWNLOAD_FAILED");
}

export async function analyzeVideoCreateProduct(
  assets: MediaAsset[],
  portrait?: { name: string; source_url: string },
): Promise<VideoCreateRecommendation> {
  const portraitTags = portrait ? parsePortraitTags(portrait.name) : undefined;
  const images = await Promise.all([
    ...assets.map(productImage),
    ...(portrait ? [responseImage(portrait.source_url, "PORTRAIT_REFERENCE_DOWNLOAD_FAILED")] : []),
  ]);
  const result = await aihubmix.analyzeImages({
    images,
    model: VIDEO_CREATE_ANALYSIS_MODEL,
    prompt: `你是中文短视频广告策划。前 ${assets.length} 张是同一商品的商品图片${portrait ? "，最后 1 张是已选出镜人像" : ""}。${portraitTags ? `已选出镜人像标签为 ${formatPortraitIdentity(portraitTags)}，presenterGenders 必须使用“${portraitTags.gender === "男" ? "男声" : "女声"}”，不得根据商品或目标受众改变出镜人像的年龄、性别和职业。` : ""}综合分析图片，只基于可见事实给出可直接生成口播脚本的完整参数。严格返回 JSON：
{"productName":"","sellingPoints":[],"scene":"内容种草","durationSec":15,"segmentCount":1,"speechRate":"medium","requirements":"","scriptStyle":"自然种草","marketingGoals":[],"targetAudiences":[],"audiencePainPoints":"","productBenefits":"","presenterRoles":[],"presenterGenders":[],"contentStyles":[],"openingStyles":[],"closingGuides":[],"scriptTopics":[],"materialTopics":[],"marketingMethods":[],"templates":[],"sensitiveWords":"","customRequirements":""}
sellingPoints 最多 8 条；scene 只能为商城转化/短视频带货/引流直播间/直播带货/内容种草/品牌曝光/本地到店/线索收集之一；durationSec 为 15、30、60、180 之一；segmentCount 为 1-12；speechRate 只能为 slow/medium/fast。多选字段只能使用下列值：
marketingGoals=电商转化/品牌曝光/App下载/门店到店/直播引流；targetAudiences=18-24岁女性/25-35岁女性/18-24岁男性/25-35岁男性/宝妈/学生/职场白领/中老年/全年龄段；presenterRoles=好物推荐员/普通用户/行业专家/品牌官方；presenterGenders=不区分/男声/女声；contentStyles=种草/专业测评/情绪共鸣/悬念叙事/故事/数据说话；openingStyles=自动匹配/痛点直击/数字冲击/福利诱惑/问句互动/品牌声量/随机；closingGuides=硬引导购买/软种草/互动提问；scriptTopics=直播带货/产品功能讲解/痛点解决/对比测评/情感共鸣/节日营销；materialTopics=产品外观/使用体验/价格优势/品质保障/售后服务/用户口碑/生活方式/成分功效/限时优惠；marketingMethods=场景展示/痛点解决/竞品对比/用户证言/专家背书/限时促销；templates=常规/节日营销/明星同款/爆款复制。无法从图片判断时返回空数组或空字符串，不要使用绝对化承诺。`,
  });
  const recommendation = normalizeVideoCreateRecommendation(parseAdScriptModelJson(result.text));
  return portraitTags
    ? { ...recommendation, presenterGenders: [portraitTags.gender === "男" ? "男声" : "女声"] }
    : recommendation;
}

export function generateVideoCreateScript(aggregate: VideoCreateAggregate): Promise<VideoCreateGeneratedScript> {
  const input = aggregate.project.input;
  const { segmentCount: _segmentCount, ...scriptInput } = input;
  const targetCharacters = videoCreateTargetCharacterCount(input.durationSec, input.speechRate);
  return generateStructured(
    `你是专业中文短视频广告编导。为商品生成可直接配音的结构化连续脚本。严格返回 JSON：
{"sections":[{"label":"开场痛点","text":"","durationSec":3}]}
脚本模块数量由内容动态决定，至少 3 个；必须包含开场痛点、产品介绍、收尾引导，也可以增加使用场景、卖点拆解、信任背书或优惠信息等模块。模块是文案语义结构，不是视频分镜。
所有模块组成一篇前后连贯的口播文案，总字数目标约 ${targetCharacters} 字（允许上下浮动 10%），所有模块时长之和尽量为 ${input.durationSec} 秒。语速为 ${input.speechRate}，每段衔接自然，突出真实卖点并避免夸大承诺。
业务参数：${JSON.stringify(scriptInput)}`,
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
  const { segmentCount: _segmentCount, ...scriptInput } = aggregate.project.input;
  return generateStructured(
    `你是中文短视频广告编导。改写指定段落，保持用途和时长，只返回 JSON：
{"label":"${section.label}","text":"","durationSec":${section.currentVersion.durationSec}}
项目参数：${JSON.stringify(scriptInput)}
当前段落：${section.currentVersion.text}`,
    VideoCreateGeneratedScriptSchema.shape.sections.element,
    { maxTokens: 1_000 },
  );
}

export function generateVideoCreateStoryboard(
  aggregate: VideoCreateAggregate,
  portraitName?: string,
): Promise<VideoCreateGeneratedStoryboard> {
  const legacyPortrait = getPortraitById(aggregate.project.input.portraitId);
  const portraitTags = parsePortraitTags(portraitName ?? legacyPortrait?.name ?? "");
  const storyboardInput = portraitTags
    ? {
        ...aggregate.project.input,
        presenterGenders: [portraitTags.gender === "男" ? "男声" : "女声"],
      }
    : aggregate.project.input;
  const sections = aggregate.sections.map((section) => ({
    label: section.label,
    text: section.currentVersion?.text,
    durationSec: section.currentVersion?.durationSec,
  }));
  return generateStructured(
    `你是短视频分镜导演。根据商品信息和完整口播脚本，重新切分口播并生成可直接提交视频模型的中文画面提示词。严格返回 JSON：
{"shots":[{"prompt":"当前分镜画面摘要","narration":"该分镜连续口播原文","durationSec":5,"generationPlan":{"characterAppearance":"人物外形服饰","cameraView":"镜头视角","background":"全局背景","lighting":"全局光线","voice":"全局音色","quality":"画质要求","subshots":[{"action":"人物动作","narration":"子镜头连续口播原文","expression":"说话神态","voiceTone":"音色语气","durationSec":2,"shotSize":"近景","composition":"画面构图","background":"背景环境","lighting":"光线风格"},{"action":"人物动作","narration":"子镜头连续口播原文","expression":"说话神态","voiceTone":"音色语气","durationSec":3,"shotSize":"中景","composition":"画面构图","background":"背景环境","lighting":"光线风格"}]}}]}
必须恰好 ${aggregate.project.input.segmentCount} 个镜头，不受脚本语义模块数量影响。按原始顺序把完整口播分配给所有镜头，不能遗漏、重复或改写口播内容；每个镜头的 narration 必须非空。所有镜头时长之和尽量为 ${aggregate.project.input.durationSec} 秒，单镜头不超过 15 秒。
每个镜头还要规划内部子镜头：durationSec 小于 10 秒时生成 2 个，10-15 秒时生成 3 个；优先按口播句意和标点拆分，子镜头 narration 按顺序拼接后必须与所属镜头 narration 完全一致，子镜头 durationSec 之和必须等于所属镜头 durationSec。每个子镜头分别描述人物动作、说话神态、音色语气、景别、构图、背景和光线；动作要随口播推进，不能重复套话。prompt 是所属镜头的简洁画面摘要，包含主体、动作、场景、运镜、画幅和商品一致性要求，不要在画面中生成额外文字。
${portraitTags ? `已选出镜人像标签为 ${formatPortraitIdentity(portraitTags)}。所有 generationPlan.characterAppearance、voice、人物动作、神态和构图必须与该标签一致；不得根据商品、目标受众或营销场景另行推断人物年龄、性别或职业。` : ""}
项目参数：${JSON.stringify(storyboardInput)}
脚本：${JSON.stringify(sections)}`,
    VideoCreateGeneratedStoryboardSchema,
    { maxTokens: 12_000 },
  );
}
