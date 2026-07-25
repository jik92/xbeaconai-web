import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildArkSeedanceReferenceContent } from "../../server/providers/ark-seedance";
import {
  allocateVideoCreateSubshotDurations,
  buildVideoCreateShotGenerationPrompt,
  createFallbackVideoCreateShotPlan,
  splitVideoCreateSubshotText,
  validateVideoCreateShotGenerationReferences,
} from "../../server/video-create/shot-generation";
import { VideoCreateGeneratedStoryboardSchema } from "../../server/video-create/types";
import { normalizeVideoCreateAttachmentLabels } from "../../web/features/video-create/video-create-shot-generation-dialog";

describe("video create shot generation review", () => {
  test("constructs the exact two-part prompt with semantic image categories and three subshots", () => {
    const narration = "夏天出门还在为搭配饰发愁？这款复古草帽透气不闷头，搭啥都好看。出游拍照巨出片！";
    const plan = createFallbackVideoCreateShotPlan({
      durationSec: 15,
      shotPrompt: "女生对镜头摊手，随后戴上草帽侧身展示，最后对镜头比耶",
      narration,
    });
    plan.characterAppearance = "年轻女性，淡妆，自然黑发，身穿白色衬衫";
    plan.voice = "年轻女性，亲切自然，语速适中";
    plan.quality = "高清电影感，年轻女性肤色自然";
    plan.subshots[0] = {
      ...plan.subshots[0],
      action: "23岁的女生对镜头摊手，随后她拿起草帽，其他行人从背景经过",
      composition: "年轻女性位于画面中心",
      voiceTone: "甜美女声，轻松自然",
    };
    const prompt = buildVideoCreateShotGenerationPrompt({
      durationSec: 15,
      plan,
      references: [
        { label: "Image1", name: "中国 22岁 男 牙医", role: "reference_image", category: "人物" },
        { label: "Image2", name: "复古草帽", role: "reference_image", category: "商品" },
      ],
    });

    expect(plan.subshots).toHaveLength(3);
    expect(plan.subshots.map((subshot) => subshot.narration).join("")).toBe(narration);
    expect(plan.subshots.reduce((total, subshot) => total + subshot.durationSec, 0)).toBe(15);
    expect(prompt.startsWith("### 第一部分：全局基础设定\n约束条件：")).toBe(true);
    expect(prompt).toContain("画面中唯一出镜人物必须使用 @Image1（人物）");
    expect(prompt).toContain("人物标签为 中国 22岁 男性 牙医");
    expect(prompt).toContain("禁止生成女性、女生、女孩或女人");
    expect(prompt).toContain("保持其性别、年龄、脸型、五官、肤色、发型和身份特征一致");
    expect(prompt).toContain("人物动作描述：人物对镜头摊手，随后人物拿起草帽，其他行人从背景经过");
    expect(prompt).toContain("画面构图：人物位于画面中心");
    expect(prompt).not.toContain("年轻女性");
    expect(prompt).not.toContain("23岁的女生");
    expect(prompt).not.toContain("淡妆");
    expect(prompt).not.toContain("甜美女声");
    expect(prompt).toContain("音色语气设定：甜美人物音色，轻松自然");
    expect(prompt).toContain("画质要求：高清电影感，人物肤色自然");
    expect(prompt).toContain("音色设定：22岁男性音色，声音年龄与性别必须与 @Image1（人物） 一致");
    expect(prompt).toContain("商品外观严格参考 @Image2（商品）");
    expect(prompt).toContain("### 第二部分：分镜内容（按播放顺序逐条输出分镜，每条独立成段，并标注序号）");
    expect(prompt.match(/^分镜 \d{2}$/gmu)).toHaveLength(3);
    expect(prompt).toContain("画面口播文案：夏天出门还在为搭配饰发愁？");
    expect(prompt).not.toContain("绑定参考素材");
    expect(prompt).not.toContain("执行要求");
    expect(prompt).not.toContain("画面生成要求");
    expect(
      validateVideoCreateShotGenerationReferences({
        prompt,
        references: [{ id: "product", label: "Image2", mimeType: "image/png", byteSize: 1024, category: "商品" }],
        portraitLabel: "Image1",
        portraitCategory: "人物",
      }),
    ).toBeUndefined();
  });

  test("uses female portrait tags instead of a conflicting male plan and limits audio references to style", () => {
    const plan = createFallbackVideoCreateShotPlan({
      durationSec: 6,
      shotPrompt: "年轻男性在街景中展示商品",
      narration: "自然展示这款商品。",
    });
    plan.characterAppearance = "年轻男性，短发，身穿衬衫";
    plan.voice = "低沉男声";
    const prompt = buildVideoCreateShotGenerationPrompt({
      durationSec: 6,
      plan,
      references: [
        { label: "Image1", name: "中国 32岁 女 律师", role: "reference_image", category: "人物" },
        { label: "Audio1", name: "参考音色", role: "reference_audio" },
      ],
    });

    expect(prompt).toContain("人物标签为 中国 32岁 女性 律师");
    expect(prompt).toContain("禁止生成男性、男生、男孩或男人");
    expect(prompt).toContain("音色设定：32岁女性音色");
    expect(prompt).toContain("@Audio1 仅用于参考音色质感、语速和情绪，不得改变人物性别、年龄或身份");
    expect(prompt).not.toContain("低沉男声");
    expect(prompt).not.toContain("年轻男性");
  });

  test("keeps the planned appearance when no portrait reference is selected", () => {
    const plan = createFallbackVideoCreateShotPlan({
      durationSec: 6,
      shotPrompt: "年轻女性在街景中展示商品",
      narration: "这款商品轻巧又方便。",
    });
    plan.characterAppearance = "年轻女性，淡妆，自然黑发，身穿白色衬衫";
    const prompt = buildVideoCreateShotGenerationPrompt({ durationSec: 6, plan, references: [] });

    expect(prompt).toContain("人物形象：年轻女性，淡妆，自然黑发，身穿白色衬衫");
    expect(prompt).toContain("背景描述：遵循当前分镜的真实生活化场景设定：年轻女性在街景中展示商品");
  });

  test("splits a short current shot into two semantic subshots with exact duration", () => {
    const narration = "这款复古草帽透气不闷头，搭啥都好看";
    const parts = splitVideoCreateSubshotText(narration, 2);
    expect(parts).toEqual(["这款复古草帽透气不闷头，", "搭啥都好看"]);
    expect(allocateVideoCreateSubshotDurations(parts, 6).reduce((total, duration) => total + duration, 0)).toBe(6);
    expect(
      createFallbackVideoCreateShotPlan({
        durationSec: 6,
        shotPrompt: "女生拿起草帽戴上，侧身展示帽型",
        narration,
      }).subshots,
    ).toHaveLength(2);
  });

  test("rejects model plans that lose narration or break the parent-shot duration", () => {
    const narration = "先展示商品外观，再说明核心卖点。";
    const generationPlan = createFallbackVideoCreateShotPlan({
      durationSec: 6,
      shotPrompt: "人物拿起商品并转动展示细节",
      narration,
    });
    const shot = {
      prompt: "人物在生活化场景中拿起商品并展示外观细节",
      narration,
      durationSec: 6,
      generationPlan,
    };
    expect(
      VideoCreateGeneratedStoryboardSchema.parse({ shots: [shot] }).shots[0]?.generationPlan.subshots,
    ).toHaveLength(2);
    expect(() =>
      VideoCreateGeneratedStoryboardSchema.parse({
        shots: [
          {
            ...shot,
            generationPlan: {
              ...generationPlan,
              subshots: generationPlan.subshots.map((subshot, index) =>
                index === 0 ? { ...subshot, narration: "遗漏后的口播" } : subshot,
              ),
            },
          },
        ],
      }),
    ).toThrow();
  });

  test("accepts references only when every prompt tag resolves to an owned attachment", () => {
    const prompt = "近景展示商品使用方式，并严格参考 @Image1（商品）和 @Image2（商品）的外观完成六秒镜头。";
    expect(
      validateVideoCreateShotGenerationReferences({
        prompt,
        references: [
          { id: "asset-1", label: "Image1", mimeType: "image/png", byteSize: 1024, category: "商品" },
          { id: "asset-2", label: "Image2", mimeType: "image/jpeg", byteSize: 2048, category: "商品" },
        ],
      }),
    ).toBeUndefined();
    expect(
      validateVideoCreateShotGenerationReferences({ prompt: `${prompt} 同时参考 @Video1。`, references: [] }),
    ).toBe("@Image1 未绑定到提交附件");
    expect(
      validateVideoCreateShotGenerationReferences({
        prompt: "镜头严格参考 @Image1 的商品外观完成自然展示。",
        references: [{ id: "asset-1", label: "Image1", mimeType: "image/png", byteSize: 1024 }],
      }),
    ).toBe("图片参考必须分类为人物或商品");
  });

  test("accepts a portrait followed by multiple product images and rejects label gaps", () => {
    expect(
      validateVideoCreateShotGenerationReferences({
        prompt: "镜头严格参考 @Image1（人物），并结合 @Image2（商品）与 @Image3（商品）完成展示。",
        references: [
          { id: "asset-1", label: "Image2", mimeType: "image/png", byteSize: 1024, category: "商品" },
          { id: "asset-2", label: "Image3", mimeType: "image/webp", byteSize: 1024, category: "商品" },
        ],
        portraitLabel: "Image1",
        portraitCategory: "人物",
      }),
    ).toBeUndefined();
    expect(
      validateVideoCreateShotGenerationReferences({
        prompt: "镜头严格参考 @Image1（商品）与 @Image3（商品）的外观完成六秒展示。",
        references: [
          { id: "asset-1", label: "Image1", mimeType: "image/png", byteSize: 1024, category: "商品" },
          { id: "asset-2", label: "Image3", mimeType: "image/webp", byteSize: 1024, category: "商品" },
        ],
      }),
    ).toBe("image参考标签必须按顺序绑定为 @Image2");
  });

  test("keeps multiple Seedance images in provider content order", () => {
    expect(
      buildArkSeedanceReferenceContent([
        { kind: "image", url: "https://example.test/portrait.jpg" },
        { kind: "image", url: "https://example.test/product-front.jpg" },
        { kind: "image", url: "https://example.test/product-side.jpg" },
        { kind: "audio", url: "https://example.test/voice.wav" },
      ]),
    ).toEqual([
      {
        type: "image_url",
        image_url: { url: "https://example.test/portrait.jpg" },
        role: "reference_image",
      },
      {
        type: "image_url",
        image_url: { url: "https://example.test/product-front.jpg" },
        role: "reference_image",
      },
      {
        type: "image_url",
        image_url: { url: "https://example.test/product-side.jpg" },
        role: "reference_image",
      },
      {
        type: "audio_url",
        audio_url: { url: "https://example.test/voice.wav" },
        role: "reference_audio",
      },
    ]);
  });

  test("renumbers image prompt tags after an attachment is removed", () => {
    const normalized = normalizeVideoCreateAttachmentLabels("使用 @Image2（商品）的正面和 @Image3（商品）的侧面。", [
      {
        source: "asset",
        assetId: "00000000-0000-4000-8000-000000000001",
        label: "Image2",
        name: "正面图",
        mimeType: "image/png",
        role: "reference_image",
        category: "商品",
        url: "/api/assets/1/content",
      },
      {
        source: "asset",
        assetId: "00000000-0000-4000-8000-000000000002",
        label: "Image3",
        name: "侧面图",
        mimeType: "image/jpeg",
        role: "reference_image",
        category: "商品",
        url: "/api/assets/2/content",
      },
    ]);

    expect(normalized.attachments.map((item) => item.label)).toEqual(["Image1", "Image2"]);
    expect(normalized.prompt).toContain("使用 @Image1（商品）的正面和 @Image2（商品）的侧面");
    expect(normalized.prompt).not.toContain("@Image3");
  });

  test("builds the draft from every selected product image instead of only the first", () => {
    const source = readFileSync(resolve(import.meta.dir, "../../server/app.ts"), "utf8");
    const draftSource = source.slice(
      source.indexOf("function getVideoCreateShotGenerationDraft"),
      source.indexOf("const getVideoCreateShotGenerationDraftRoute"),
    );
    expect(draftSource).toContain("for (const productId of aggregate.project.input.productAssetIds)");
    expect(draftSource).toContain('category: "人物"');
    expect(draftSource).toContain('category: "商品"');
    expect(draftSource).not.toContain("aggregate.project.input.productAssetIds[0]");
  });

  test("builds every batch job from the same portrait-bound generation draft", () => {
    const source = readFileSync(resolve(import.meta.dir, "../../server/app.ts"), "utf8");
    const batchSource = source.slice(
      source.indexOf("const batchGenerateVideoCreateShotsRoute"),
      source.indexOf("const replaceVideoCreateShotRoute"),
    );

    expect(batchSource).toContain("getVideoCreateShotGenerationDraft(projectId, shot.id, ownerUserId)");
    expect(batchSource).toContain("prompt: draft.prompt");
    expect(batchSource).toContain("references: draft.attachments.flatMap");
    expect(batchSource).toContain('attachment.source === "portrait"');
    expect(batchSource).not.toContain("shotOptions: options");
  });
});
