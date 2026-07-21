import { resolve } from "node:path";
import { parseAdScriptModelJson } from "../server/ad-script/model";
import { analyzeImagesWithGemini } from "../server/providers/gemini-video-analysis";
import {
  generateVideoCreateScript,
  generateVideoCreateStoryboard,
  normalizeVideoCreateRecommendation,
  regenerateVideoCreateSection,
} from "../server/video-create/model";
import type { VideoCreateAggregate } from "../server/video-create/video-create-store";

const timestamp = new Date().toISOString();
const projectId = crypto.randomUUID();
const aggregate: VideoCreateAggregate = {
  project: {
    id: projectId,
    ownerUserId: crypto.randomUUID(),
    title: "真实文本能力验收",
    status: "script_review",
    input: {
      productAssetIds: [crypto.randomUUID()],
      scene: "内容种草",
      productName: "轻盈通勤衬衫",
      sellingPoints: ["亲肤面料", "利落剪裁", "适合通勤"],
      durationSec: 15,
      segmentCount: 3,
      speechRate: "medium",
      requirements: "面向职场女性，表达自然克制",
      scriptStyle: "真实体验种草",
      marketingGoals: ["电商转化"],
      targetAudiences: ["职场白领"],
      audiencePainPoints: "夏季通勤衬衫容易闷热、缺少精神",
      productBenefits: "亲肤透气，剪裁利落",
      presenterRoles: ["好物推荐员"],
      presenterGenders: ["女声"],
      contentStyles: ["种草"],
      openingStyles: ["痛点直击"],
      closingGuides: ["软种草"],
      scriptTopics: ["痛点解决"],
      materialTopics: ["使用体验"],
      marketingMethods: ["场景展示"],
      templates: ["常规"],
      sensitiveWords: "最佳 极致",
      customRequirements: "语气自然克制，不制造焦虑",
      videoModel: "doubao-seedance-2-0-fast-260128",
      ratio: "9:16",
      subtitles: true,
      priority: "speech",
    },
    recommendation: null,
    currentJobId: null,
    finalArtifactId: null,
    version: 1,
    idempotencyKey: null,
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  sections: [],
  shots: [],
  canCompose: false,
};

const imageResult = await analyzeImagesWithGemini({
  images: [{ path: resolve("public/logo.png"), mimeType: "image/png" }],
  prompt: `分析图片并按短视频商品策划格式返回 JSON：{"productName":"","sellingPoints":[],"scene":"内容种草","durationSec":15,"segmentCount":3,"requirements":"","scriptStyle":"自然种草","marketingGoals":[],"targetAudiences":[],"audiencePainPoints":"","productBenefits":"","presenterRoles":[],"presenterGenders":[],"contentStyles":[],"openingStyles":[],"closingGuides":[],"scriptTopics":[],"materialTopics":[],"marketingMethods":[],"templates":[],"sensitiveWords":"","customRequirements":""}。即使图片不是商品，也要如实描述，不得虚构；多选字段没有可靠依据时返回空数组。`,
});
const recommendation = normalizeVideoCreateRecommendation(parseAdScriptModelJson(imageResult.text));
const script = await generateVideoCreateScript(aggregate);
aggregate.sections = script.sections.map((section, index) => {
  const sectionId = crypto.randomUUID();
  const version = {
    id: crypto.randomUUID(),
    sectionId,
    sequence: 1,
    source: "generated" as const,
    parentVersionId: null,
    text: section.text,
    durationSec: section.durationSec,
    model: "deepseek-v4-pro",
    createdAt: timestamp,
  };
  return {
    id: sectionId,
    projectId,
    ordinal: index + 1,
    label: section.label,
    currentVersionId: version.id,
    createdAt: timestamp,
    updatedAt: timestamp,
    versions: [version],
    currentVersion: version,
  };
});
const regenerated = await regenerateVideoCreateSection(aggregate, aggregate.sections[0].id);
const storyboard = await generateVideoCreateStoryboard(aggregate);

if (script.sections.length !== 3 || storyboard.shots.length !== 3 || !regenerated.text.trim())
  throw new Error("VIDEO_CREATE_REAL_TEXT_ASSERTION_FAILED");
console.log(
  JSON.stringify({
    productAnalysisModel: imageResult.model,
    recommendation,
    scriptSections: script.sections.length,
    regeneratedCharacters: [...regenerated.text].length,
    storyboardShots: storyboard.shots.length,
  }),
);
