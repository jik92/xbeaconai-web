import { describe, expect, test } from "bun:test";
import {
  analyzeScriptRemix,
  buildScriptRemixAnalysisRequest,
  compileScriptRemixShotPrompt,
  parseScriptRemixPlan,
  SCRIPT_REMIX_ANALYSIS_MODEL,
  validateScriptRemixPlan,
} from "../../server/video-remix/script-analysis";

const script = "快闪开！这一车裤子全涌出来了。";
const planJson = JSON.stringify({
  productFacts: {
    visibleFeatures: ["荧光黄绿色高腰阔腿裤", "松紧褶皱腰头", "腰头中央方形装饰标", "右侧流苏装饰"],
    unknownOrUnverified: ["具体面料成分", "实际凉感与显瘦效果"],
  },
  global: {
    ratio: "9:16",
    visualStyle: "真实手机纪实拍摄，轻微手持",
    characters: ["40岁左右中国女老板，米白色短袖，普通话自然快速"],
    scene: "封闭物流装卸区，货车后门打开，包装货物滑落",
    backgroundElements: ["物流托盘", "推货车", "工人清点货物"],
    lighting: "自然日光",
    audio: "保留搬箱和包装摩擦声",
    subtitleStyle: "粗黑体白字黑描边，位于下方三分之一安全区",
    ctaPolicy: "voice_only_no_avatar_ui",
  },
  shots: [
    {
      title: "分镜 01",
      durationSeconds: 6,
      speech: script,
      speakingRate: "自然快速，约日常1.2倍",
      timeline: [
        {
          startSeconds: 0,
          endSeconds: 2,
          speech: "快闪开！",
          speaker: "女老板",
          shotType: "真人口播主镜",
          visual: "女老板侧身避让滑落纸箱，镜头快速后退。",
        },
        {
          startSeconds: 2,
          endSeconds: 6,
          speech: "这一车裤子全涌出来了。",
          speaker: "女老板",
          shotType: "环境叙事插入镜",
          visual: "镜头扫过货车后门、包装货物和清点工人。",
        },
      ],
      startFrameAnchor: "女老板位于画面右侧，货车后门在左后方。",
      endFrameAnchor: "镜头停在女老板手持包装裤子的中近景。",
      transitionToNext: "无",
      referencedImages: ["Image1"],
      negativeConstraints: ["不生成头像和平台UI"],
    },
  ],
});

describe("script remix analysis", () => {
  test("uses Ark DeepSeek V4 Pro and requires real product images", () => {
    expect(SCRIPT_REMIX_ANALYSIS_MODEL).toBe("deepseek-v4-pro-260425");
    const request = buildScriptRemixAnalysisRequest({
      script,
      productName: "夏季阔腿裤",
      productDescription: "",
      portrait: "",
      voice: "",
      imageLabels: ["Image1"],
      productFacts: JSON.parse(planJson).productFacts,
    });
    expect(request).toContain("商品参考图标签：Image1");
    expect(request).toContain("voice_only_no_avatar_ui");
    expect(request).toContain("每秒最多 6 个汉字");
    expect(request).toContain("<script>");
  });

  test("validates exact speech coverage and compiles stable Seedance Markdown", () => {
    const plan = validateScriptRemixPlan(parseScriptRemixPlan(planJson), script);
    const prompt = compileScriptRemixShotPrompt(plan, plan.shots[0]);
    expect(prompt).toContain("原文口播：快闪开！这一车裤子全涌出来了。");
    expect(prompt).toContain("商品只参考：Image1");
    expect(prompt).toContain("ctaPolicy 为 voice_only_no_avatar_ui 时，不做指向头像的动作");
    expect(() => validateScriptRemixPlan(plan, `${script}不能遗漏`)).toThrow("SCRIPT_PRESERVATION_FAILED");
  });

  test("submits image-aware input and returns compiled prompts", async () => {
    const result = await analyzeScriptRemix({
      script,
      productName: "夏季阔腿裤",
      productDescription: "",
      portrait: "",
      voice: "",
      productImages: [{ path: "/tmp/product.jpg", mimeType: "image/jpeg", label: "Image1" }],
      generateMultimodal: async (input) => {
        if (input.images.length) {
          expect(input.images[0]?.label).toBe("Image1");
          return {
            text: JSON.stringify(JSON.parse(planJson).productFacts),
            model: input.model,
          };
        }
        expect(input.model).toBe("deepseek-v4-pro-260425");
        return {
          text: JSON.stringify({
            global: JSON.parse(planJson).global,
            shots: JSON.parse(planJson).shots,
          }),
          model: input.model,
        };
      },
    });
    expect(result.shots).toHaveLength(1);
    expect(result.shots[0]?.durationSeconds).toBe(6);
    expect(result.shots[0]?.prompt).toContain("荧光黄绿色高腰阔腿裤");
  });
});
