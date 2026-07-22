import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx"), "utf8");
const storyboard = page.split("{stage === 3 && (")[1]?.split("{stage === 4 && (")[0] ?? "";

describe("video remix storyboard media preview", () => {
  test("previews the selected original or generated version through an authenticated asset route", () => {
    expect(page).toContain("activeGeneratedVersion?.artifact ??");
    expect(page).toContain("`/api/assets/${sourceAssetId}/content`");
    expect(storyboard).toContain("url={activePreview.url}");
    expect(storyboard).toContain('loadingText="正在载入分镜视频…"');
    expect(storyboard).toContain('errorText="分镜视频加载失败"');
    expect(storyboard).not.toContain('<div className="warehouse-scene">');
  });

  test("renders selected product images and portrait instead of empty placeholders", () => {
    expect(storyboard).toContain("selectedProduct?.images.slice(0, 4).map");
    expect(storyboard).toContain("url={image.url}");
    expect(storyboard).toContain("url={selectedPortrait.source_url}");
    expect(storyboard).not.toContain("<span />");
  });

  test("handles public portrait failures and disables unavailable result downloads", () => {
    expect(page).toContain('className="public-image-error"');
    expect(page).toContain("onError={() => setFailed(true)}");
    expect(storyboard).toContain("disabled={!activeGeneratedVersion?.artifact.url}");
  });
});
