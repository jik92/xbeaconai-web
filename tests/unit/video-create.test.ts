import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AccountStore } from "../../server/accounts/account-store";
import { env } from "../../server/env";
import { SqliteJobStore } from "../../server/jobs/sqlite-job-store";
import type { JobRecord } from "../../server/types";
import { normalizeVideoCreateRecommendation } from "../../server/video-create/model";
import type { VideoCreateInput } from "../../server/video-create/types";
import {
  VideoCreateStateError,
  VideoCreateStore,
  VideoCreateVersionConflictError,
} from "../../server/video-create/video-create-store";
import { JobProcessor } from "../../worker/job-processor";

const databases: string[] = [];
const generatedFiles: string[] = [];
afterEach(() => {
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

describe("video create domain", () => {
  test("normalizes model aliases and drops unsupported recommendation tags", () => {
    const recommendation = normalizeVideoCreateRecommendation({
      productName: "通勤衬衫",
      sellingPoints: ["亲肤"],
      scene: "内容种草",
      durationSec: 15,
      segmentCount: 2,
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

  test("isolates owners, versions scripts and gates composition", async () => {
    const path = join(tmpdir(), `video-create-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const accounts = new AccountStore(path);
    const store = new VideoCreateStore(path);
    const owner = await accounts.register({
      email: "video-create@example.com",
      password: "Password123",
      displayName: "成片用户",
    });
    const other = await accounts.register({
      email: "video-create-other@example.com",
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
        { label: "卖点介绍", text: "这件衬衫面料亲肤，剪裁利落，通勤也能轻松有气质。", durationSec: 11 },
      ],
    });
    expect(scripted?.sections).toHaveLength(2);
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
        shots: [{ prompt: "竖屏近景展示通勤女性整理衬衫衣领，晨间自然光", durationSec: 4 }],
      }),
    ).toThrow(VideoCreateStateError);
    const storyboard = store.replaceShots(projectId, {
      shots: [
        { prompt: "竖屏近景展示通勤女性整理衬衫衣领，晨间自然光", durationSec: 4 },
        { prompt: "竖屏中景展示衬衫亲肤面料和利落剪裁，镜头轻推", durationSec: 11 },
      ],
    });
    expect(storyboard?.canCompose).toBe(false);
    if (!storyboard) throw new Error("STORYBOARD_NOT_CREATED");
    store.updateShot(storyboard.shots[0].id, { status: "succeeded", videoAssetId: crypto.randomUUID() });
    expect(store.get(projectId)?.canCompose).toBe(false);
    store.updateShot(storyboard.shots[1].id, { status: "replaced", videoAssetId: crypto.randomUUID() });
    expect(store.get(projectId)?.canCompose).toBe(true);

    store.close();
    accounts.close();
  });

  test("marks automated video generation as explicit mock without calling Seedance", async () => {
    const path = join(tmpdir(), `video-create-mock-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const accounts = new AccountStore(path);
    const projects = new VideoCreateStore(path);
    const jobs = new SqliteJobStore(path);
    const owner = await accounts.register({
      email: "video-create-mock@example.com",
      password: "Password123",
      displayName: "Mock 视频用户",
    });
    const projectId = crypto.randomUUID();
    projects.createDraft({ id: projectId, ownerUserId: owner.user.id, title: "Mock 视频验收", projectInput: input });
    projects.replaceScripts(projectId, {
      sections: [{ label: "内容种草", text: "这件衬衫亲肤利落，适合日常通勤。", durationSec: 5 }],
    });
    const storyboard = projects.replaceShots(projectId, {
      shots: [{ prompt: "竖屏中景展示通勤衬衫，人物自然走动，柔和日光", durationSec: 5 }],
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
      values: { operation: "shot", projectId, shotId: shot.id, __mockVideo: "true" },
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
    const processor = new JobProcessor(jobs, accounts, undefined, projects);
    await processor.process(job.id);
    expect(jobs.get(job.id)?.status).toBe("succeeded");
    expect(jobs.get(job.id)?.overallExecutionMode).toBe("mock");
    expect(projects.get(projectId)?.shots[0].status).toBe("succeeded");
    expect(projects.get(projectId)?.canCompose).toBe(true);

    jobs.close();
    projects.close();
    accounts.close();
  });
});
