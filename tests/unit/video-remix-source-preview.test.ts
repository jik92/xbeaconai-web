import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("video remix source preview", () => {
  test("plays the selected source inline through the authenticated asset endpoint", () => {
    const page = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx"), "utf8");

    expect(page).toContain('className="uploaded-video-player"');
    expect(page).toContain("<AuthenticatedMedia");
    expect(page).toContain("url={`/api/assets/${sourceAssetId}/content`}");
    expect(page).toContain('loadingText="正在载入原始片源…"');
    expect(page).toContain('errorText="原始片源预览失败"');
  });

  test("keeps source replacement separate from video playback", () => {
    const page = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx"), "utf8");

    expect(page).toContain('className="uploaded-video-preview"');
    expect(page).toContain('<button type="button" onClick={open}>');
    expect(page).toContain("重新选择");
    expect(page).not.toContain('className="uploaded-video-card" onClick={open}');
  });
});
