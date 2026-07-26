import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteJobStore } from "../../server/jobs/sqlite-job-store";
import { CustomPortraitStore } from "../../server/portraits/custom-portrait-store";
import { advanceVideoCreateAutoWorkflow } from "../../server/video-create/auto-workflow";
import { createFallbackVideoCreateShotPlan } from "../../server/video-create/shot-generation";
import type { VideoCreateInput } from "../../server/video-create/types";
import { VideoCreateStore } from "../../server/video-create/video-create-store";
import {
  defaultVideoCreateSubtitleStyleId,
  defaultVideoCreateVoiceSettings,
} from "../../shared/video-create/media-settings";
import { createTestAccountStore, registerTestAccount } from "./account-test-helper";

const databases: string[] = [];
afterEach(() => {
  for (const path of databases.splice(0)) {
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});

const projectInput = (productAssetIds: string[]): VideoCreateInput => ({
  productAssetIds,
  scene: "内容种草",
  productName: "轻盈通勤衬衫",
  sellingPoints: ["亲肤面料"],
  durationSec: 15,
  segmentCount: 1,
  speechRate: "medium",
  requirements: "",
  scriptStyle: "自然种草",
  marketingGoals: [],
  targetAudiences: [],
  audiencePainPoints: "",
  productBenefits: "",
  presenterRoles: [],
  presenterGenders: [],
  contentStyles: [],
  openingStyles: [],
  closingGuides: [],
  scriptTopics: [],
  materialTopics: [],
  marketingMethods: [],
  templates: [],
  sensitiveWords: "",
  customRequirements: "",
  videoModel: "doubao-seedance-2-0-mini-260615",
  ratio: "9:16",
  subtitles: true,
  voiceSettings: defaultVideoCreateVoiceSettings,
  subtitleStyleId: defaultVideoCreateSubtitleStyleId,
});

describe("video create automatic workflow", () => {
  test("accepts an image-free draft and idempotently starts analysis after one-click generation", async () => {
    const path = join(tmpdir(), `video-create-auto-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const accounts = createTestAccountStore(path);
    const jobs = new SqliteJobStore(path);
    const projects = new VideoCreateStore(path);
    const portraits = new CustomPortraitStore(path);
    const owner = await registerTestAccount(accounts, {
      phone: "13800000981",
      password: "Password123",
      displayName: "一键生成用户",
    });
    const projectId = crypto.randomUUID();
    const emptyDraft = projects.createDraft({
      id: projectId,
      ownerUserId: owner.user.id,
      title: "空图片草稿",
      projectInput: projectInput([]),
    });
    expect(emptyDraft.project.input.productAssetIds).toEqual([]);

    const productId = crypto.randomUUID();
    accounts.createAsset({
      id: productId,
      ownerUserId: owner.user.id,
      storageKey: `${productId}.jpg`,
      originalName: "product.jpg",
      mimeType: "image/jpeg",
      byteSize: 1024,
      kind: "product",
      displayName: "通勤衬衫",
      createdAt: new Date().toISOString(),
    });
    projects.updateInput(projectId, owner.user.id, emptyDraft.project.version, projectInput([productId]));
    const runId = crypto.randomUUID();
    projects.setProject(projectId, { autoGenerate: true, autoGenerateRunId: runId });
    const enqueued: string[] = [];
    const dependencies = {
      store: jobs,
      videoCreates: projects,
      accounts,
      customPortraits: portraits,
      queue: { enqueue: async (jobId: string) => void enqueued.push(jobId) },
    };
    const started = await advanceVideoCreateAutoWorkflow(dependencies, projectId);
    expect(Array.isArray(started)).toBe(false);
    expect(enqueued).toHaveLength(1);
    expect(jobs.get(enqueued[0] ?? "")?.values.operation).toBe("analyze");
    expect(projects.get(projectId)?.project.status).toBe("analyzing");

    const savedInput = projectInput([productId]);
    const {
      productAssetIds: _productAssetIds,
      portraitReference: _portraitReference,
      portraitId: _portraitId,
      voiceAssetId: _voiceAssetId,
      videoModel: _videoModel,
      ratio: _ratio,
      subtitles: _subtitles,
      voiceSettings: _voiceSettings,
      subtitleStyleId: _subtitleStyleId,
      ...recommendation
    } = savedInput;
    projects.setRecommendation(projectId, recommendation);
    const analysisJob = jobs.update(enqueued[0] ?? "", { status: "succeeded" });
    if (!analysisJob) throw new Error("AUTO_ANALYSIS_JOB_NOT_FOUND");
    await advanceVideoCreateAutoWorkflow(dependencies, projectId, analysisJob);
    expect(jobs.get(enqueued[1] ?? "")?.values.operation).toBe("script");

    projects.replaceScripts(projectId, {
      sections: [{ label: "内容种草", text: "这件衬衫亲肤利落，适合日常通勤。", durationSec: 15 }],
    });
    const scriptJob = jobs.update(enqueued[1] ?? "", { status: "succeeded" });
    if (!scriptJob) throw new Error("AUTO_SCRIPT_JOB_NOT_FOUND");
    await advanceVideoCreateAutoWorkflow(dependencies, projectId, scriptJob);
    expect(jobs.get(enqueued[2] ?? "")?.values.operation).toBe("storyboard");

    const narration = "这件衬衫亲肤利落，适合日常通勤。";
    projects.replaceShots(projectId, {
      shots: [
        {
          prompt: "竖屏中景展示通勤衬衫，人物自然走动，柔和日光",
          narration,
          durationSec: 15,
          generationPlan: createFallbackVideoCreateShotPlan({
            durationSec: 15,
            shotPrompt: "竖屏中景展示通勤衬衫，人物自然走动，柔和日光",
            narration,
          }),
        },
      ],
    });
    const storyboardJob = jobs.update(enqueued[2] ?? "", { status: "succeeded" });
    if (!storyboardJob) throw new Error("AUTO_STORYBOARD_JOB_NOT_FOUND");
    const shotJobs = await advanceVideoCreateAutoWorkflow(dependencies, projectId, storyboardJob);
    expect(Array.isArray(shotJobs)).toBe(true);
    expect(jobs.get(enqueued[3] ?? "")?.values.operation).toBe("shot");

    const shot = projects.get(projectId)?.shots[0];
    if (!shot) throw new Error("AUTO_SHOT_NOT_FOUND");
    const videoAssetId = crypto.randomUUID();
    projects.completePendingMaterialVersion({
      jobId: enqueued[3] ?? "",
      storageKind: "artifact",
      contentId: videoAssetId,
      subtitlesComposed: false,
    });
    projects.updateShot(shot.id, {
      status: "succeeded",
      videoAssetId,
      audioEnabled: false,
      subtitleEnabled: false,
    });
    const shotJob = jobs.update(enqueued[3] ?? "", { status: "succeeded" });
    if (!shotJob) throw new Error("AUTO_SHOT_JOB_NOT_FOUND");
    await advanceVideoCreateAutoWorkflow(dependencies, projectId, shotJob);
    expect(jobs.get(enqueued[4] ?? "")?.values.operation).toBe("compose");

    const failed = jobs.update(enqueued[4] ?? "", { status: "failed" });
    if (!failed) throw new Error("AUTO_COMPOSE_JOB_NOT_FOUND");
    await advanceVideoCreateAutoWorkflow(dependencies, projectId, failed);
    expect(projects.get(projectId)?.project.autoGenerate).toBe(false);

    portraits.close();
    projects.close();
    jobs.close();
    accounts.close();
  });
});
