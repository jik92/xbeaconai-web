import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx"), "utf8");
const storyboard = page.split("{stage === 3 && (")[1]?.split("{stage === 4 && (")[0] ?? "";
const remixApi = readFileSync(resolve(import.meta.dir, "../../server/app.ts"), "utf8");
const seedanceWorker = readFileSync(resolve(import.meta.dir, "../../worker/jobs/job-seedance-video.ts"), "utf8");
const arkSeedance = readFileSync(resolve(import.meta.dir, "../../server/providers/ark-seedance.ts"), "utf8");

describe("video remix storyboard editor", () => {
  test("uses the source strip as the only clip switcher and keeps the correction canvas focused", () => {
    expect(page).toContain('className="source-strip"');
    expect(storyboard).toContain('className="storyboard-editor"');
    expect(storyboard).toContain("<PromptWorkbench");
    expect(storyboard).not.toContain('className="result-card"');
    expect(storyboard).not.toContain('className="shot-version-strip"');
  });

  test("keeps all product, portrait, and attached images beside the prompt", () => {
    expect(page).toContain("const storyboardReferenceImages = useMemo");
    expect(page).toContain("...selectedPortraits.map");
    expect(page).toContain("...(selectedProduct?.images ?? []).map");
    expect(storyboard).toContain("storyboard-reference-cluster");
    expect(storyboard).toContain('className="storyboard-reference-image"');
    expect(storyboard).toContain('className="storyboard-add-reference"');
    expect(storyboard).not.toContain('className="storyboard-reference-toggle"');
    expect(storyboard).toContain("onSelect={appendShotReferences}");
    expect(page).toContain("assets.filter((asset) => !known.has(asset.id))");
  });

  test("handles public portrait failures and keeps generation controls in the editor", () => {
    expect(page).toContain('className="public-image-error"');
    expect(page).toContain("onImageError={() => setFailed(true)}");
    expect(storyboard).toContain('aria-label="视频模型"');
    expect(storyboard).toContain("submitting={Boolean(activeShotRunning)}");
    expect(storyboard).toContain('submitLabel="生成视频"');
    expect(storyboard).not.toContain("进入合并成片");
    expect(page).toContain("setPendingShotSubmission(submission)");
    expect(page).toContain("setSubmittedShotJobId(created.id)");
    expect(page).toContain("setStage(4)");
  });

  test("confirms submission, then renders a read-only execution snapshot", () => {
    expect(page).toContain("任务提交后不可取消、不可停止。");
    expect(page).toContain('className="shot-submit-confirm"');
    expect(page).toContain('className="shot-execution-panel"');
    expect(page).toContain("正在生成视频，预计耗时约 4–5 分钟");
    expect(page).toContain("引用素材库");
    expect(page).toContain("已提交提示词");
    expect(page).toContain("生成参数");
    expect(storyboard).toContain("visibleExecutionSnapshot ? (");
  });

  test("shows unverified video models in the workbench instead of replacing it with an empty state", () => {
    expect(page).toContain('model.kind === "video"');
    expect(page).not.toContain('model.kind === "video" && model.enabled');
    expect(storyboard).toContain('model.enabled ? "" : "（未验证）"');
  });

  test("defaults new remix shots to Seedance 2.0 Mini and 15 seconds while restoring saved settings", () => {
    expect(page).toContain('const remixDefaultVideoModelId = "doubao-seedance-2-0-mini-260615"');
    expect(page).toContain("const remixDefaultDuration = 15");
    expect(page).toContain("const savedJob = shotJobs.find");
    expect(page).toContain("savedJob?.videoModel");
    expect(page).toContain("Number(savedJob?.values.duration)");
  });

  test("binds every visible image without filtering by @Image labels", () => {
    expect(page).toContain("const buildShotSubmission = (sourceId: string)");
    expect(page).not.toContain("const mentionedLabels = new Set");
    expect(page).not.toContain("ensurePrimaryProductReference");
    expect(page).toContain("references: quotedReferences.flatMap");
    expect(page).toContain("portraitReferences: quotedReferences.flatMap");
    expect(storyboard).toContain("mentions={storyboardReferenceImages.map");
    expect(remixApi).toContain("const RemixReferenceLabelSchema");
    expect(remixApi).toContain("referenceBindings: JSON.stringify");
    expect(remixApi).toContain('referenceMode: "omni"');
    expect(remixApi).toContain("referenceCount: String(body.references.length + body.portraitReferences.length)");
    expect(remixApi).not.toContain("UNBOUND_PROMPT_REFERENCE");
    expect(storyboard).toContain("submitDisabled={");
    expect(storyboard).toContain("storyboardReferenceImages.length === 0");
    expect(remixApi).toContain("const references = referenceAssets.filter");
    expect(remixApi).not.toContain("const references = [sourceAsset, ...referenceAssets]");
    expect(remixApi).not.toContain("...(sourceJob.values.portraitReference");
    expect(seedanceWorker).toContain('job.moduleId === "video-remix"');
    expect(seedanceWorker).toContain("remixPortraitReferences(job.values)");
    expect(seedanceWorker).toContain('...(job.moduleId === "video-remix"');
    expect(arkSeedance).toContain("input.generateAudio === undefined ? {} : { generate_audio: input.generateAudio }");
  });

  test("batch-generates every script shot and auto-composes only after each is ready", () => {
    expect(storyboard).toContain("一键生成全部并合片");
    expect(page).toContain("const prepareBatchGeneration");
    expect(page).toContain("const submitBatchGeneration");
    expect(page).toContain("Promise.allSettled(submissions.map");
    expect(page).toContain("全部完成后将自动合并成片");
    expect(page).toContain("const allSourcesReady");
    expect(page).toContain("void startCompose()");
  });
});
