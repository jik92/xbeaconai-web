import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { videoCreateActionAvailability } from "../../web/features/video-create/video-create-actions";

describe("video create action boundaries", () => {
  test("uses one shared header for the four project actions above the two-column workbench", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../../web/features/video-create/video-create-page.tsx"),
      "utf8",
    );
    for (const label of ["一键生成", "保存草稿", "生成记录", "新建"]) expect(source).toContain(label);
    expect(source.match(/<VideoCreateWorkflowHeader/g)).toHaveLength(1);
    expect(source).toContain('<ol className="flex min-w-0 items-center justify-center" aria-label="一键成片创作进度">');
    expect(source).not.toContain("<h1");
    expect(source).toContain('<History /> <span className="max-[1100px]:hidden">生成记录</span>');
    expect(source).toContain('className="grid min-h-0 flex-1 grid-cols-[360px_minmax(0,1fr)]');
    expect(source).toContain('runVideoCreateProjectAction(saved.project.id, "full")');
  });
  test("keeps script generation available before a storyboard exists", () => {
    expect(videoCreateActionAvailability({ hasScript: false, hasStoryboard: false })).toEqual({
      scriptLabel: "生成脚本",
      scriptLocked: false,
      storyboardLabel: "生成分镜",
      storyboardLocked: true,
    });
    expect(videoCreateActionAvailability({ hasScript: true, hasStoryboard: false })).toEqual({
      scriptLabel: "生成脚本",
      scriptLocked: false,
      storyboardLabel: "生成分镜",
      storyboardLocked: false,
    });
  });

  test("locks script changes after storyboard generation", () => {
    expect(videoCreateActionAvailability({ hasScript: true, hasStoryboard: true })).toEqual({
      scriptLabel: "生成脚本",
      scriptLocked: true,
      storyboardLabel: "分镜已生成",
      storyboardLocked: true,
    });
  });

  test("keeps the left action on script and the right action on storyboard", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../../web/features/video-create/video-create-page.tsx"),
      "utf8",
    );
    expect(source).toContain('onClick={() => action("script")}');
    expect(source).toContain('onClick={() => action("storyboard")}');
    expect(source.match(/action\("script"\)/g)).toHaveLength(1);
    expect(source).not.toContain('action(project?.sections.length ? "storyboard" : "script")');
  });

  test("does not expose the removed speech or visual priority selector", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../../web/features/video-create/video-create-page.tsx"),
      "utf8",
    );

    expect(source).not.toContain("口播优先");
    expect(source).not.toContain("画面优先");
    expect(source).not.toContain('mutateInput("priority"');
  });

  test("defaults both the new-project form and AI template to one segment", () => {
    const pageSource = readFileSync(
      resolve(import.meta.dir, "../../web/features/video-create/video-create-page.tsx"),
      "utf8",
    );
    const modelSource = readFileSync(resolve(import.meta.dir, "../../server/video-create/model.ts"), "utf8");
    expect(pageSource).toContain("segmentCount: 1");
    expect(modelSource).toContain('"segmentCount":1');
    expect(modelSource).not.toContain('"segmentCount":3');
  });

  test("keeps script semantics independent from the requested storyboard count", () => {
    const pageSource = readFileSync(
      resolve(import.meta.dir, "../../web/features/video-create/video-create-page.tsx"),
      "utf8",
    );
    const modelSource = readFileSync(resolve(import.meta.dir, "../../server/video-create/model.ts"), "utf8");
    const appSource = readFileSync(resolve(import.meta.dir, "../../server/app.ts"), "utf8");
    const scriptGenerator = modelSource
      .split("export function generateVideoCreateScript")[1]
      ?.split("export function regenerateVideoCreateSection")[0];

    expect(scriptGenerator).toContain("开场痛点、产品介绍、收尾引导");
    expect(scriptGenerator).toContain("videoCreateTargetCharacterCount");
    expect(scriptGenerator).not.toContain("input.segmentCount");
    expect(modelSource).toContain('"generationPlan"');
    expect(modelSource).toContain("durationSec 小于 10 秒时生成 2 个，10-15 秒时生成 3 个");
    expect(pageSource).not.toContain(
      'mutateInput("segmentCount", Math.max(input.segmentCount, Math.ceil(seconds / 15)))',
    );
    expect(appSource).toContain('action === "storyboard" &&');
    expect(appSource).not.toContain('action === "script" && aggregate.project.input.segmentCount');
  });

  test("uses the shared shadcn Switch for every storyboard toggle", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../../web/features/video-create/video-create-page.tsx"),
      "utf8",
    );
    expect(source).toContain('import { Switch } from "@/components/ui/switch"');
    expect(source.match(/<Switch/g)).toHaveLength(5);
    expect(source).not.toContain("ShotToggle");
  });

  test("opens batch shot generation from the material header with a shadcn Dialog", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../../web/features/video-create/video-create-page.tsx"),
      "utf8",
    );
    expect(source).toContain("批量生成");
    expect(source).toContain("<Dialog open={batchDialogOpen}");
    expect(source).toContain("batchGenerateVideoCreateShotVideos");
  });

  test("shares the Mini audio-enabled settings with batch and individual generation", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../../web/features/video-create/video-create-page.tsx"),
      "utf8",
    );
    expect(source).toContain('videoModel: "doubao-seedance-2-0-mini-260615"');
    expect(source).toContain("generateAudio: true");
    expect(source).toContain("fetchVideoCreateShotGenerationDraft(project.project.id, shotId)");
    expect(source).toContain("generateVideoCreateShotVideo(project.project.id, shotGenerationShotId, options)");
    expect(source).toContain("batchGenerateVideoCreateShotVideos(project.project.id, batchSettings)");
    expect(source).toContain("audioEnabled: !options.generateAudio");
    expect(source).toContain("audioEnabled: !batchSettings.generateAudio");
    expect(source).not.toContain("generateAudio: false");
  });

  test("reviews the constructed prompt, attachments, execution mode, and audio behavior before submit", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../../web/features/video-create/video-create-shot-generation-dialog.tsx"),
      "utf8",
    );
    expect(source).toContain("最终视频生成提示词");
    expect(source).toContain("attachment.label");
    expect(source).toContain('draft.executionMode === "mock" ? "FFmpeg Mock" : "真实 Seedance API"');
    expect(source).toContain("保留生成视频原声，分镜配音将关闭");
    expect(source).toContain('referenceMode: "omni"');
    expect(source).toContain('value="人物"');
    expect(source).toContain('value="商品"');
    expect(source).toContain("fitVideoCreateShotPlanDuration");
  });

  test("persists native-audio selection and avoids composing subtitles twice", () => {
    const app = readFileSync(resolve(import.meta.dir, "../../server/app.ts"), "utf8");
    const worker = readFileSync(resolve(import.meta.dir, "../../worker/jobs/job-video-create.ts"), "utf8");
    const page = readFileSync(
      resolve(import.meta.dir, "../../web/features/video-create/video-create-page.tsx"),
      "utf8",
    );

    expect(app).toContain("audioEnabled: !input.shotOptions.generateAudio");
    expect(app).toContain('input.operation === "audio-generate" ? { audioEnabled: true } : {}');
    expect(app).toContain("subtitleEnabled: String(shot.subtitleEnabled)");
    expect(worker).toContain("if (subtitleEnabled)");
    expect(worker).toContain('nameSuffix = ""');
    expect(worker).toContain("!currentMaterialVersion?.subtitlesComposed");
    expect(worker).toContain('"SUBTITLES_ALREADY_COMPOSED"');
    expect(page).toContain("shot.subtitleStyleStale");
    expect(page).toContain('"按新样式合成"');
  });

  test("keeps row-level audio, subtitle, and immutable material history actions", () => {
    const page = readFileSync(
      resolve(import.meta.dir, "../../web/features/video-create/video-create-page.tsx"),
      "utf8",
    );
    const history = readFileSync(
      resolve(import.meta.dir, "../../web/features/video-create/video-create-material-history-dialog.tsx"),
      "utf8",
    );
    expect(page).toContain("配音替换");
    expect(page).toContain("字幕合成");
    expect(page).toContain("生成历史");
    expect(page).toContain('processShotMaterial(shot.id, "audio-replace")');
    expect(page).toContain('processShotMaterial(shot.id, "subtitle-compose")');
    expect(history).toContain("选择此版本");
    expect(history).toContain("当前使用");
    expect(history).toContain("AuthenticatedMedia");
    expect(history).toContain("Card, CardContent");
    expect(history).toContain('className="space-y-3"');
    expect(history).toContain('label="模型"');
    expect(history).toContain('label="提交时间"');
    expect(history).toContain('label="总耗时"');
    expect(history).toContain("grid-rows-[auto_minmax(0,1fr)]");
    expect(history).toContain('className="min-h-0 overflow-y-auto pr-1"');
    expect(history).not.toContain("grid grid-cols-1 gap-3 sm:grid-cols-2");
  });

  test("exposes project-level voice and subtitle settings with stale output states", () => {
    const page = readFileSync(
      resolve(import.meta.dir, "../../web/features/video-create/video-create-page.tsx"),
      "utf8",
    );
    const dialogs = readFileSync(
      resolve(import.meta.dir, "../../web/features/video-create/video-create-media-settings-dialogs.tsx"),
      "utf8",
    );
    expect(page).toContain('aria-label="配音设置"');
    expect(page).toContain('aria-label="字幕样式设置"');
    expect(page).toContain("batchGenerateVideoCreateVoices");
    expect(page).toContain("shot.audioStale");
    expect(page).toContain("shot.subtitleStyleStale");
    expect(dialogs).toContain("配音设置");
    expect(dialogs).toContain("字幕样式设置");
    expect(dialogs).toContain("批量生成配音");
    expect(page).toContain('{ ...shot, status: "queued" as const, audioEnabled: true, error: undefined }');
    expect(dialogs).toContain("previewVideoCreatePresetVoice");
  });

  test("clears the script beside copy only after confirming dependent storyboard removal", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../../web/features/video-create/video-create-page.tsx"),
      "utf8",
    );
    expect(source).toContain("复制脚本");
    expect(source).toContain("清除脚本");
    expect(source).toContain("当前脚本和依赖的分镜记录将无法恢复");
    expect(source).toContain("已经生成的视频、音频和素材库文件会继续保留");
    expect(source).toContain("await clearVideoCreateScript(project.project.id)");
    expect(source).toContain("setDrafts({})");
  });
});
