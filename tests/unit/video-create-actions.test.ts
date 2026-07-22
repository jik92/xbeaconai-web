import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { videoCreateActionAvailability } from "../../web/features/video-create/video-create-actions";

describe("video create action boundaries", () => {
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

  test("defaults both the new-project form and AI template to three segments", () => {
    const pageSource = readFileSync(
      resolve(import.meta.dir, "../../web/features/video-create/video-create-page.tsx"),
      "utf8",
    );
    const modelSource = readFileSync(resolve(import.meta.dir, "../../server/video-create/model.ts"), "utf8");
    expect(pageSource).toContain("segmentCount: 3");
    expect(modelSource).toContain('"segmentCount":3');
    expect(modelSource).not.toContain('"segmentCount":1');
  });

  test("uses the shared shadcn Switch for every storyboard toggle", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../../web/features/video-create/video-create-page.tsx"),
      "utf8",
    );
    expect(source).toContain('import { Switch } from "@/components/ui/switch"');
    expect(source.match(/<Switch/g)).toHaveLength(4);
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
});
