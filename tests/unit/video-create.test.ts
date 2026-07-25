import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { env } from "../../server/env";
import { SqliteJobStore } from "../../server/jobs/sqlite-job-store";
import { getPortraitById } from "../../server/portraits/catalog";
import { buildGptImageAnalysisRequest } from "../../server/providers/aihubmix";
import type { JobRecord } from "../../server/types";
import { normalizeVideoCreateRecommendation, videoCreateTargetCharacterCount } from "../../server/video-create/model";
import { createFallbackVideoCreateShotPlan } from "../../server/video-create/shot-generation";
import { VideoCreateGeneratedScriptSchema, type VideoCreateInput } from "../../server/video-create/types";
import {
  VideoCreateStateError,
  VideoCreateStore,
  VideoCreateVersionConflictError,
  videoCreateBatchEligibleShots,
  videoCreateMaterialVersionJobDetails,
  videoCreateMinimumStoryboardCount,
  videoCreateShotNarration,
} from "../../server/video-create/video-create-store";
import { JobProcessor } from "../../worker/job-processor";
import { assertSeedanceDuration, SeedanceFlowError } from "../../worker/jobs/job-seedance-video";
import {
  buildSubtitleCues,
  resolveVideoCreateShotGenerationSettings,
  resolveVideoCreateSubtitleDuration,
} from "../../worker/jobs/job-video-create";
import { createTestAccountStore, registerTestAccount } from "./account-test-helper";

const databases: string[] = [];
const generatedFiles: string[] = [];
const originalMockGenerateVideoApi = env.mockGenerateVideoApi;
afterEach(() => {
  env.mockGenerateVideoApi = originalMockGenerateVideoApi;
  for (const path of databases.splice(0)) {
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
  for (const path of generatedFiles.splice(0)) rmSync(path, { force: true });
});

const input: VideoCreateInput = {
  productAssetIds: ["00000000-0000-4000-8000-000000000001"],
  scene: "内容种草",
  productName: "轻盈通勤衬衫",
  sellingPoints: ["亲肤面料", "利落剪裁"],
  durationSec: 15,
  segmentCount: 2,
  speechRate: "medium",
  requirements: "面向职场女性",
  scriptStyle: "自然种草",
  marketingGoals: ["电商转化"],
  targetAudiences: ["职场白领"],
  audiencePainPoints: "通勤衬衫闷热且容易显得没精神",
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
  sensitiveWords: "最 最佳",
  customRequirements: "语气自然克制",
  videoModel: "doubao-seedance-2-0-fast-260128",
  ratio: "9:16",
  subtitles: true,
  priority: "speech",
};

function generationPlan(durationSec: number, prompt: string, narration: string) {
  return createFallbackVideoCreateShotPlan({ durationSec, shotPrompt: prompt, narration });
}

describe("video create domain", () => {
  test("derives total script characters from duration and speech rate", () => {
    expect(videoCreateTargetCharacterCount(15, "slow")).toBe(45);
    expect(videoCreateTargetCharacterCount(30, "medium")).toBe(120);
    expect(videoCreateTargetCharacterCount(60, "fast")).toBe(300);
    expect(() =>
      VideoCreateGeneratedScriptSchema.parse({
        sections: [
          { label: "开场痛点", text: "痛点", durationSec: 3 },
          { label: "产品介绍", text: "介绍", durationSec: 8 },
        ],
      }),
    ).toThrow();
  });

  test("applies the video-model duration limit only when planning storyboards", () => {
    expect(videoCreateMinimumStoryboardCount(15)).toBe(1);
    expect(videoCreateMinimumStoryboardCount(30)).toBe(2);
    expect(videoCreateMinimumStoryboardCount(60)).toBe(4);
    expect(videoCreateMinimumStoryboardCount(180)).toBe(12);
  });

  test("batch generation only selects pending and failed shots", () => {
    const statuses = ["pending", "failed", "queued", "generating", "succeeded", "replaced"] as const;
    expect(videoCreateBatchEligibleShots(statuses.map((status) => ({ status }))).map((shot) => shot.status)).toEqual([
      "pending",
      "failed",
    ]);
  });

  test("builds readable subtitle cues across the real audio duration", () => {
    const cues = buildSubtitleCues("夏天穿搭总没精神？这顶草帽轻松增加层次感。喜欢就试试看！", 9);
    expect(cues).toHaveLength(3);
    expect(cues[0]?.startSec).toBe(0);
    expect(cues.at(-1)?.endSec).toBe(9);
    expect(cues.every((cue) => cue.endSec > cue.startSec)).toBe(true);
    expect(cues.every((cue) => cue.endSec <= 9)).toBe(true);
  });

  test("rejects video and audio durations that would truncate the requested result", () => {
    expect(assertSeedanceDuration(15, 14.1, "测试结果")).toBe(14.1);
    expect(() => assertSeedanceDuration(15, 5.088, "测试结果")).toThrow(SeedanceFlowError);
    expect(() =>
      resolveVideoCreateSubtitleDuration({
        videoDurationSec: 5.088,
        audioDurationSec: 14.9625,
        generatedWithAudio: false,
      }),
    ).toThrow("配音时长 14.963 秒超过视频时长 5.088 秒");
    expect(
      resolveVideoCreateSubtitleDuration({
        videoDurationSec: 5.088,
        audioDurationSec: 14.9625,
        generatedWithAudio: true,
      }),
    ).toBe(5.088);
  });

  test("maps generated native audio and subtitle choices to post-processing settings", () => {
    const current = { audioEnabled: true, subtitleEnabled: true };
    expect(
      resolveVideoCreateShotGenerationSettings({ generateAudio: "true", subtitleEnabled: "true" }, current),
    ).toEqual({ generatedWithAudio: true, subtitleEnabled: true });
    expect(
      resolveVideoCreateShotGenerationSettings({ generateAudio: "false", subtitleEnabled: "false" }, current),
    ).toEqual({ generatedWithAudio: false, subtitleEnabled: false });
    expect(resolveVideoCreateShotGenerationSettings({}, current)).toEqual({
      generatedWithAudio: false,
      subtitleEnabled: true,
    });
  });

  test("derives material history parameters and execution time from the linked job", () => {
    const createdAt = "2026-07-25T10:00:00.000Z";
    const details = videoCreateMaterialVersionJobDetails({
      id: crypto.randomUUID(),
      ownerUserId: crypto.randomUUID(),
      moduleId: "video-create",
      title: "生成分镜视频",
      status: "succeeded",
      progress: 100,
      stage: "已完成",
      overallExecutionMode: "real",
      values: {
        operation: "shot",
        durationSec: "15",
        ratio: "9:16",
        resolution: "720p",
        generateAudio: "true",
      },
      videoModel: "doubao-seedance-2-0-mini-260615",
      executionPlan: [],
      provenance: [],
      cancelRequested: false,
      providerCancelState: "none",
      stagingKeys: [],
      jobSchemaVersion: 2,
      createdAt,
      updatedAt: "2026-07-25T10:02:31.500Z",
    });
    expect(details).toEqual({
      generation: {
        model: "doubao-seedance-2-0-mini-260615",
        durationSec: 15,
        ratio: "9:16",
        resolution: "720p",
        generateAudio: true,
      },
      execution: {
        submittedAt: createdAt,
        completedAt: "2026-07-25T10:02:31.500Z",
        durationSec: 151.5,
      },
    });
    expect(videoCreateMaterialVersionJobDetails()).toEqual({ generation: null, execution: null });
  });

  test("normalizes model aliases and drops unsupported recommendation tags", () => {
    const recommendation = normalizeVideoCreateRecommendation({
      productName: "通勤衬衫",
      sellingPoints: ["亲肤"],
      scene: "内容种草",
      durationSec: 15,
      segmentCount: 2,
      speechRate: "medium",
      requirements: "",
      scriptStyle: "自然种草",
      marketingGoals: ["销售转化", "未知目标"],
      targetAudiences: ["职场女性"],
      presenterRoles: ["产品推荐官"],
      contentStyles: ["真实体验"],
      openingStyles: [],
      closingGuides: [],
      scriptTopics: [],
      materialTopics: [],
      marketingMethods: ["场景化展示"],
      templates: [],
      audiencePainPoints: "",
      productBenefits: "",
      sensitiveWords: "",
      customRequirements: "",
    });
    expect(recommendation.marketingGoals).toEqual(["电商转化"]);
    expect(recommendation.targetAudiences).toEqual(["职场白领"]);
    expect(recommendation.presenterRoles).toEqual(["好物推荐员"]);
    expect(recommendation.marketingMethods).toEqual(["场景展示"]);
  });

  test("resolves only portraits from the controlled catalog", () => {
    expect(getPortraitById(1)).toMatchObject({ index: 1, source_url: expect.stringMatching(/^https:\/\//) });
    expect(getPortraitById(999_999)).toBeUndefined();
  });

  test("builds a GPT multimodal request with every selected image", () => {
    const request = buildGptImageAnalysisRequest({
      model: "gpt-5.4-mini",
      prompt: "分析商品和人像",
      images: [
        { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
        { bytes: new Uint8Array([4, 5]), mimeType: "image/jpeg" },
      ],
    });
    expect(request.model).toBe("gpt-5.4-mini");
    expect(request.response_format).toEqual({ type: "json_object" });
    expect(request.messages[0]?.content[0]).toEqual({ type: "text", text: "分析商品和人像" });
    expect(request.messages[0]?.content.slice(1)).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,BAU=" } },
    ]);
  });

  test("AI recommendation overwrites every script parameter and preserves resource choices", async () => {
    const path = join(tmpdir(), `video-create-overwrite-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const accounts = createTestAccountStore(path);
    const owner = await registerTestAccount(accounts, {
      phone: "13800000012",
      password: "Password123",
      displayName: "AI 覆盖用户",
    });
    const store = new VideoCreateStore(path);
    const projectId = crypto.randomUUID();
    store.createDraft({
      id: projectId,
      ownerUserId: owner.user.id,
      title: "全量覆盖",
      projectInput: { ...input, portraitId: 1, voiceAssetId: "00000000-0000-4000-8000-000000000002" },
    });
    const updated = store.setRecommendation(projectId, {
      productName: "AI 产品名",
      sellingPoints: ["AI 卖点"],
      scene: "品牌曝光",
      durationSec: 60,
      segmentCount: 2,
      speechRate: "fast",
      requirements: "AI 要求",
      scriptStyle: "AI 风格",
      marketingGoals: ["品牌曝光"],
      targetAudiences: ["全年龄段"],
      audiencePainPoints: "AI 痛点",
      productBenefits: "AI 利益点",
      presenterRoles: ["品牌官方"],
      presenterGenders: ["男声"],
      contentStyles: ["数据说话"],
      openingStyles: ["数字冲击"],
      closingGuides: ["互动提问"],
      scriptTopics: ["产品功能讲解"],
      materialTopics: ["产品外观"],
      marketingMethods: ["专家背书"],
      templates: ["常规"],
      sensitiveWords: "绝对化表达",
      customRequirements: "AI 自定义要求",
    });
    expect(updated?.project.input).toMatchObject({
      productAssetIds: input.productAssetIds,
      portraitId: 1,
      voiceAssetId: "00000000-0000-4000-8000-000000000002",
      videoModel: input.videoModel,
      ratio: input.ratio,
      subtitles: input.subtitles,
      priority: input.priority,
      productName: "AI 产品名",
      sellingPoints: ["AI 卖点"],
      scene: "品牌曝光",
      durationSec: 60,
      segmentCount: 2,
      speechRate: "fast",
      requirements: "AI 要求",
      sensitiveWords: "绝对化表达",
      customRequirements: "AI 自定义要求",
    });
    store.close();
    accounts.close();
  });

  test("isolates owners, versions scripts and gates composition", async () => {
    const path = join(tmpdir(), `video-create-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const accounts = createTestAccountStore(path);
    const store = new VideoCreateStore(path);
    const owner = await registerTestAccount(accounts, {
      phone: "13800000009",
      password: "Password123",
      displayName: "成片用户",
    });
    const other = await registerTestAccount(accounts, {
      phone: "13800000010",
      password: "Password123",
      displayName: "其他用户",
    });
    const projectId = crypto.randomUUID();
    const created = store.createDraft({
      id: projectId,
      ownerUserId: owner.user.id,
      title: "通勤衬衫种草",
      projectInput: input,
      idempotencyKey: "video-create-1",
    });
    expect(created.project.status).toBe("draft");
    expect(created.project.input.marketingGoals).toEqual(["电商转化"]);
    expect(store.getOwned(projectId, other.user.id)).toBeUndefined();
    expect(
      store.createDraft({
        id: crypto.randomUUID(),
        ownerUserId: owner.user.id,
        title: "重复请求",
        projectInput: input,
        idempotencyKey: "video-create-1",
      }).project.id,
    ).toBe(projectId);

    const scripted = store.replaceScripts(projectId, {
      sections: [
        { label: "开场共鸣", text: "职场穿搭总怕闷热又没精神？", durationSec: 4 },
        { label: "卖点介绍", text: "这件衬衫面料亲肤，剪裁利落。", durationSec: 7 },
        { label: "收尾引导", text: "通勤也能轻松穿出好气质。", durationSec: 4 },
      ],
    });
    expect(scripted?.sections).toHaveLength(3);
    const first = scripted?.sections[0];
    expect(first?.currentVersion?.source).toBe("generated");
    if (!first?.currentVersionId) throw new Error("SCRIPT_SECTION_NOT_CREATED");
    const initialVersionId = first.currentVersionId;
    const edited = store.appendScriptVersion({
      projectId,
      sectionId: first.id,
      expectedVersionId: initialVersionId,
      text: "上班穿搭总怕闷热又显得没精神？",
      durationSec: 4,
      source: "human",
    });
    expect(edited?.sequence).toBe(2);
    expect(() =>
      store.appendScriptVersion({
        projectId,
        sectionId: first.id,
        expectedVersionId: initialVersionId,
        text: "冲突版本",
        durationSec: 4,
        source: "human",
      }),
    ).toThrow(VideoCreateVersionConflictError);

    expect(() =>
      store.replaceShots(projectId, {
        shots: [
          {
            prompt: "竖屏近景展示通勤女性整理衬衫衣领，晨间自然光",
            narration: "上班穿搭总怕闷热又显得没精神？",
            durationSec: 4,
            generationPlan: generationPlan(
              4,
              "竖屏近景展示通勤女性整理衬衫衣领，晨间自然光",
              "上班穿搭总怕闷热又显得没精神？",
            ),
          },
        ],
      }),
    ).toThrow(VideoCreateStateError);
    const storyboard = store.replaceShots(projectId, {
      shots: [
        {
          prompt: "竖屏近景展示通勤女性整理衬衫衣领，晨间自然光",
          narration: "上班穿搭总怕闷热又显得没精神？",
          durationSec: 4,
          generationPlan: generationPlan(
            4,
            "竖屏近景展示通勤女性整理衬衫衣领，晨间自然光",
            "上班穿搭总怕闷热又显得没精神？",
          ),
        },
        {
          prompt: "竖屏中景展示衬衫亲肤面料和利落剪裁，镜头轻推",
          narration: "这件衬衫面料亲肤，剪裁利落。通勤也能轻松穿出好气质。",
          durationSec: 11,
          generationPlan: generationPlan(
            11,
            "竖屏中景展示衬衫亲肤面料和利落剪裁，镜头轻推",
            "这件衬衫面料亲肤，剪裁利落。通勤也能轻松穿出好气质。",
          ),
        },
      ],
    });
    expect(storyboard?.canCompose).toBe(false);
    if (!storyboard) throw new Error("STORYBOARD_NOT_CREATED");
    expect(storyboard.shots.every((shot) => shot.audioEnabled && shot.subtitleEnabled)).toBe(true);
    expect(storyboard.shots.map((shot) => shot.narration)).toEqual([
      "上班穿搭总怕闷热又显得没精神？",
      "这件衬衫面料亲肤，剪裁利落。通勤也能轻松穿出好气质。",
    ]);
    expect(
      storyboard.shots.every((shot) => shot.generationPlan?.subshots.length === (shot.durationSec >= 10 ? 3 : 2)),
    ).toBe(true);
    store.updateShot(storyboard.shots[0].id, { narration: "" });
    const legacyAggregate = store.get(projectId);
    expect(legacyAggregate && videoCreateShotNarration(legacyAggregate, legacyAggregate.shots[0])).toBe(
      "上班穿搭总怕闷热又显得没精神？",
    );
    expect(storyboard.shots.every((shot) => shot.subtitleCues.length === 0)).toBe(true);
    const firstMaterial = store.createAndApplyMaterialVersion({
      projectId,
      shotId: storyboard.shots[0].id,
      source: "library_replacement",
      storageKind: "asset",
      contentId: crypto.randomUUID(),
    });
    expect(firstMaterial.subtitlesComposed).toBe(false);
    const processedMaterial = store.createAndApplyMaterialVersion({
      projectId,
      shotId: storyboard.shots[0].id,
      source: "audio_replaced",
      storageKind: "artifact",
      contentId: crypto.randomUUID(),
      inputVersionId: firstMaterial.id,
      subtitlesComposed: true,
    });
    expect(processedMaterial.subtitlesComposed).toBe(true);
    expect(store.get(projectId)?.shots[0].subtitlesComposed).toBe(true);
    expect(store.listMaterialVersions(projectId, storyboard.shots[0].id, other.user.id)).toBeUndefined();
    const materialHistory = store.listMaterialVersions(projectId, storyboard.shots[0].id, owner.user.id) ?? [];
    expect(materialHistory).toHaveLength(2);
    expect(new Set(materialHistory.map((item) => item.id))).toEqual(new Set([processedMaterial.id, firstMaterial.id]));
    expect(store.get(projectId)?.shots[0].currentMaterialVersionId).toBe(processedMaterial.id);
    store.applyMaterialVersion(projectId, storyboard.shots[0].id, firstMaterial.id, owner.user.id);
    expect(store.get(projectId)?.shots[0].currentMaterialVersionId).toBe(firstMaterial.id);
    expect(store.get(projectId)?.shots[0].subtitlesComposed).toBe(false);
    expect(store.listMaterialVersions(projectId, storyboard.shots[0].id, owner.user.id)).toHaveLength(2);
    store.updateAllShotSettings(projectId, { audioEnabled: false });
    expect(store.get(projectId)?.shots.every((shot) => !shot.audioEnabled)).toBe(true);
    store.updateAllShotSettings(projectId, { audioEnabled: true });
    store.updateShot(storyboard.shots[0].id, {
      status: "succeeded",
      videoAssetId: crypto.randomUUID(),
      audioArtifactId: crypto.randomUUID(),
      subtitleCues: [{ startSec: 0, endSec: 4, text: "开场" }],
    });
    expect(store.get(projectId)?.canCompose).toBe(false);
    store.updateShot(storyboard.shots[1].id, {
      status: "replaced",
      videoAssetId: crypto.randomUUID(),
      audioArtifactId: crypto.randomUUID(),
      subtitleCues: [{ startSec: 0, endSec: 11, text: "卖点" }],
    });
    expect(store.get(projectId)?.canCompose).toBe(true);

    store.close();
    accounts.close();
  });

  test("clears scripts and dependent shots while preserving project inputs", async () => {
    const path = join(tmpdir(), `video-create-clear-script-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const accounts = createTestAccountStore(path);
    const store = new VideoCreateStore(path);
    const owner = await registerTestAccount(accounts, {
      phone: "13800000013",
      password: "Password123",
      displayName: "脚本清除用户",
    });
    const other = await registerTestAccount(accounts, {
      phone: "13800000014",
      password: "Password123",
      displayName: "其他清除用户",
    });
    const projectId = crypto.randomUUID();
    const created = store.createDraft({
      id: projectId,
      ownerUserId: owner.user.id,
      title: "待重新生成脚本",
      projectInput: { ...input, segmentCount: 1 },
    });
    store.replaceScripts(projectId, {
      sections: [{ label: "商品卖点", text: "这件衬衫亲肤透气，适合日常通勤。", durationSec: 5 }],
    });
    const storyboard = store.replaceShots(projectId, {
      shots: [
        {
          prompt: "模特在通勤场景展示衬衫",
          narration: "这件衬衫亲肤透气。",
          durationSec: 5,
          generationPlan: generationPlan(5, "模特在通勤场景展示衬衫", "这件衬衫亲肤透气。"),
        },
      ],
    });
    const shot = storyboard?.shots[0];
    if (!shot) throw new Error("SHOT_NOT_CREATED");
    store.updateShot(shot.id, { status: "queued" });
    expect(() => store.clearScripts(projectId, owner.user.id)).toThrow(VideoCreateStateError);
    store.updateShot(shot.id, { status: "succeeded", videoAssetId: crypto.randomUUID() });
    store.setProject(projectId, { status: "completed", finalArtifactId: crypto.randomUUID() });

    expect(store.clearScripts(projectId, other.user.id)).toBeUndefined();
    const cleared = store.clearScripts(projectId, owner.user.id);
    expect(cleared?.project.status).toBe("draft");
    expect(cleared?.project.version).toBe(created.project.version + 1);
    expect(cleared?.project.input).toEqual({ ...input, segmentCount: 1 });
    expect(cleared?.project.finalArtifactId).toBeNull();
    expect(cleared?.sections).toEqual([]);
    expect(cleared?.shots).toEqual([]);

    store.close();
    accounts.close();
  });

  test("uses the environment-controlled FFmpeg mock for Seedance shots", async () => {
    env.mockGenerateVideoApi = true;
    const path = join(tmpdir(), `video-create-mock-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const accounts = createTestAccountStore(path);
    const projects = new VideoCreateStore(path);
    const jobs = new SqliteJobStore(path);
    const owner = await registerTestAccount(accounts, {
      phone: "13800000011",
      password: "Password123",
      displayName: "Mock 视频用户",
    });
    const projectId = crypto.randomUUID();
    projects.createDraft({
      id: projectId,
      ownerUserId: owner.user.id,
      title: "Mock 视频验收",
      projectInput: { ...input, segmentCount: 1 },
    });
    projects.replaceScripts(projectId, {
      sections: [{ label: "内容种草", text: "这件衬衫亲肤利落，适合日常通勤。", durationSec: 5 }],
    });
    const storyboard = projects.replaceShots(projectId, {
      shots: [
        {
          prompt: "竖屏中景展示通勤衬衫，人物自然走动，柔和日光",
          narration: "这件衬衫亲肤利落，适合日常通勤。",
          durationSec: 5,
          generationPlan: generationPlan(
            5,
            "竖屏中景展示通勤衬衫，人物自然走动，柔和日光",
            "这件衬衫亲肤利落，适合日常通勤。",
          ),
        },
      ],
    });
    const shot = storyboard?.shots[0];
    if (!shot) throw new Error("SHOT_NOT_CREATED");
    const timestamp = new Date().toISOString();
    const job: JobRecord = {
      id: crypto.randomUUID(),
      ownerUserId: owner.user.id,
      moduleId: "video-create",
      title: "Mock 分镜视频",
      status: "queued",
      progress: 0,
      stage: "排队中",
      overallExecutionMode: "mock",
      values: {
        operation: "shot",
        projectId,
        shotId: shot.id,
        durationSec: "5",
        ratio: "9:16",
        generateAudio: "true",
        subtitleEnabled: "true",
        __mockAudio: "true",
      },
      videoModel: "doubao-seedance-2-0-fast-260128",
      executionPlan: [],
      provenance: [],
      cancelRequested: false,
      providerCancelState: "none",
      stagingKeys: [],
      jobSchemaVersion: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    jobs.create(job);
    generatedFiles.push(resolve(env.dataDir, "results", `${job.id}-video-create.mp4`));
    generatedFiles.push(resolve(env.dataDir, "results", `${job.id}-${shot.id}-voice.wav`));
    const processor = new JobProcessor(jobs, accounts, undefined, projects);
    await processor.process(job.id);
    expect(jobs.get(job.id)?.status).toBe("succeeded");
    expect(jobs.get(job.id)?.overallExecutionMode).toBe("mixed");
    expect(jobs.get(job.id)?.provenance.some((stage) => stage.implementation === "ffmpeg-seedance-mock")).toBe(true);
    expect(jobs.get(job.id)?.result?.artifacts[0]?.executionMode).toBe("mock");
    expect(jobs.get(job.id)?.providerTaskId).toBeUndefined();
    expect(jobs.get(job.id)?.stagingKeys).toEqual([]);
    expect(projects.get(projectId)?.shots[0].status).toBe("succeeded");
    expect(projects.get(projectId)?.shots[0].audioArtifactId).toBeTruthy();
    expect(projects.get(projectId)?.shots[0].audioEnabled).toBe(false);
    expect(projects.get(projectId)?.shots[0].subtitleCues.length).toBeGreaterThan(0);
    expect(projects.getMaterialVersionByJobId(job.id)?.subtitlesComposed).toBe(true);
    expect(projects.get(projectId)?.canCompose).toBe(true);

    for (const operation of ["audio-replace"] as const) {
      const currentShot = projects.get(projectId)?.shots[0];
      if (!currentShot?.currentMaterialVersionId) throw new Error("SHOT_MATERIAL_VERSION_NOT_CREATED");
      const processJob: JobRecord = {
        ...job,
        id: crypto.randomUUID(),
        title: operation,
        status: "queued",
        progress: 0,
        stage: "排队中",
        overallExecutionMode: "local",
        values: {
          operation,
          projectId,
          shotId: shot.id,
          inputMaterialVersionId: currentShot.currentMaterialVersionId,
          previousShotStatus: currentShot.status,
        },
        videoModel: undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      jobs.create(processJob);
      projects.createPendingMaterialVersion({
        projectId,
        shotId: shot.id,
        source: operation === "audio-replace" ? "audio_replaced" : "subtitle_composed",
        inputVersionId: currentShot.currentMaterialVersionId,
        jobId: processJob.id,
      });
      generatedFiles.push(resolve(env.dataDir, "results", `${processJob.id}-video-create.mp4`));
      await processor.process(processJob.id);
      expect(jobs.get(processJob.id)?.status).toBe("succeeded");
      expect(projects.getMaterialVersionByJobId(processJob.id)?.status).toBe("succeeded");
      expect(projects.get(projectId)?.shots[0].currentMaterialVersionId).toBe(
        projects.getMaterialVersionByJobId(processJob.id)?.id,
      );
    }
    expect(projects.listMaterialVersions(projectId, shot.id, owner.user.id)).toHaveLength(2);

    const currentShot = projects.get(projectId)?.shots[0];
    if (!currentShot?.currentMaterialVersionId) throw new Error("SHOT_MATERIAL_VERSION_NOT_CREATED");
    const duplicateSubtitleJob: JobRecord = {
      ...job,
      id: crypto.randomUUID(),
      title: "duplicate subtitle-compose",
      status: "queued",
      values: {
        operation: "subtitle-compose",
        projectId,
        shotId: shot.id,
        inputMaterialVersionId: currentShot.currentMaterialVersionId,
        previousShotStatus: currentShot.status,
      },
      videoModel: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    jobs.create(duplicateSubtitleJob);
    projects.createPendingMaterialVersion({
      projectId,
      shotId: shot.id,
      source: "subtitle_composed",
      inputVersionId: currentShot.currentMaterialVersionId,
      jobId: duplicateSubtitleJob.id,
    });
    await processor.process(duplicateSubtitleJob.id);
    expect(jobs.get(duplicateSubtitleJob.id)?.error).toMatchObject({
      code: "SUBTITLES_ALREADY_COMPOSED",
      retryable: false,
    });
    expect(projects.getMaterialVersionByJobId(duplicateSubtitleJob.id)?.status).toBe("failed");

    jobs.close();
    projects.close();
    accounts.close();
  });
});
