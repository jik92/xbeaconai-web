import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx"), "utf8");
const storyboard = page.split("{stage === 3 && (")[1]?.split("{stage === 4 && (")[0] ?? "";

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
    expect(storyboard).toContain('className="storyboard-reference-toggle"');
    expect(storyboard).toContain("setReferencesExpanded((current) => !current)");
    expect(storyboard).toContain("onSelect={appendShotReferences}");
    expect(page).toContain("patchShotDraft({ references: merged.slice(0, 2) })");
  });

  test("handles public portrait failures and keeps generation controls in the editor", () => {
    expect(page).toContain('className="public-image-error"');
    expect(page).toContain("onImageError={() => setFailed(true)}");
    expect(storyboard).toContain('aria-label="视频模型"');
    expect(storyboard).toContain("submitting={Boolean(activeShotRunning) || !activeModel?.enabled}");
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
});
