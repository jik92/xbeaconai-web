import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  moveRemixSource,
  parseRemixAnalysisEntries,
  parseRemixSources,
  remixMaxSources,
} from "../../shared/video-remix/workflow";

describe("video remix multi-source workflow", () => {
  test("deduplicates sources, preserves selection order, and caps the batch", () => {
    const sources = Array.from({ length: remixMaxSources + 2 }, (_, index) => ({
      assetId: `asset-${index}`,
      name: `${index}.mp4`,
    }));
    sources.splice(1, 0, sources[0]);

    const parsed = parseRemixSources(JSON.stringify(sources));

    expect(parsed).toHaveLength(remixMaxSources);
    expect(parsed[0]).toEqual({ assetId: "asset-0", name: "0.mp4" });
    expect(parsed[1]).toEqual({ assetId: "asset-1", name: "1.mp4" });
  });

  test("keeps independent success and failure analysis results", () => {
    expect(
      parseRemixAnalysisEntries(
        JSON.stringify([
          { assetId: "asset-a", name: "a.mp4", status: "succeeded", prompt: "prompt a" },
          { assetId: "asset-b", name: "b.mp4", status: "failed", error: "模型解析失败" },
        ]),
      ),
    ).toEqual([
      { assetId: "asset-a", name: "a.mp4", status: "succeeded", prompt: "prompt a" },
      { assetId: "asset-b", name: "b.mp4", status: "failed", error: "模型解析失败" },
    ]);
  });

  test("reorders the compose timeline without mutating the original", () => {
    const original = ["a", "b", "c"];

    expect(moveRemixSource(original, 2, 0)).toEqual(["c", "a", "b"]);
    expect(original).toEqual(["a", "b", "c"]);
    expect(moveRemixSource(original, -1, 0)).toEqual(original);
  });

  test("publishes a queued compose API and keeps preview separate from starting the merge", async () => {
    const spec = (await Bun.file(resolve(import.meta.dir, "../../openapi/openapi.json")).json()) as {
      paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, unknown> }>>;
    };
    const route = spec.paths["/api/video-remix/project/compose"]?.post;
    const page = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx"), "utf8");

    expect(route?.operationId).toBe("createVideoRemixComposeJob");
    expect(route?.responses).toHaveProperty("202");
    expect(page).toContain("multiple");
    expect(page).toContain("draggable");
    expect(page).toContain("composePreviewSource");
    expect(page).toContain("await composeRemixVideos");
    expect(page).toContain("开始合并");
  });
});
