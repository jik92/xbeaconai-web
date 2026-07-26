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
    expect(page).toContain("setSubmittedShotJobId(created.id)");
    expect(page).toContain("setStage(4)");
  });

  test("shows unverified video models in the workbench instead of replacing it with an empty state", () => {
    expect(page).toContain('model.kind === "video"');
    expect(page).not.toContain('model.kind === "video" && model.enabled');
    expect(storyboard).toContain('model.enabled ? "" : "（未验证）"');
  });

  test("binds explicit @Image labels to assets and never injects the source video or a default portrait", () => {
    expect(page).toContain("const quotedReferences = storyboardReferenceImages.filter");
    expect(page).toContain("const mentionedLabels = new Set");
    expect(page).toContain("@" + "${unresolved} 未绑定到当前参考素材库");
    expect(page).toContain("references: quotedReferences.flatMap");
    expect(page).toContain("portraitReferences: quotedReferences.flatMap");
    expect(storyboard).toContain("mentions={storyboardReferenceImages.map");
    expect(remixApi).toContain("const RemixReferenceLabelSchema");
    expect(remixApi).toContain("referenceBindings: JSON.stringify");
    expect(remixApi).toContain('referenceMode: "omni"');
    expect(remixApi).toContain("referenceCount: String(body.references.length + body.portraitReferences.length)");
    expect(remixApi).toContain("UNBOUND_PROMPT_REFERENCE");
    expect(remixApi).toContain("const references = referenceAssets.filter");
    expect(remixApi).not.toContain("const references = [sourceAsset, ...referenceAssets]");
    expect(remixApi).not.toContain("...(sourceJob.values.portraitReference");
    expect(seedanceWorker).toContain('job.moduleId === "video-remix"');
    expect(seedanceWorker).toContain("remixPortraitReferences(job.values)");
    expect(seedanceWorker).toContain('...(job.moduleId === "video-remix"');
    expect(arkSeedance).toContain("input.generateAudio === undefined ? {} : { generate_audio: input.generateAudio }");
  });
});
