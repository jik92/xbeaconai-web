import { describe, expect, test } from "bun:test";
import { resultMediaArtifacts } from "../../web/components/domain/module-page";
import type { ApiJobResult } from "../../web/entities/types";

describe("video-cut result preview", () => {
  test("keeps every generated clip instead of selecting only the first one", () => {
    const result: ApiJobResult = {
      kind: "video-cut",
      title: "镜头片段",
      summary: "已生成 2 个切片",
      artifacts: [
        {
          id: "clip-1",
          name: "clip-001.mp4",
          mimeType: "video/mp4",
          url: "/api/assets/clip-1/content",
          executionMode: "local",
          lineage: [],
        },
        {
          id: "clip-2",
          name: "clip-002.mp4",
          mimeType: "video/mp4",
          url: "/api/assets/clip-2/content",
          executionMode: "local",
          lineage: [],
        },
      ],
    };

    expect(resultMediaArtifacts(result).map((artifact) => artifact.name)).toEqual(["clip-001.mp4", "clip-002.mp4"]);
  });
});
