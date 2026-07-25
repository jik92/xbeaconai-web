import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

type OpenApiOperation = {
  operationId?: string;
  responses?: Record<string, unknown>;
  requestBody?: {
    content?: {
      "application/json"?: {
        schema?: { properties?: Record<string, { type?: string; maxItems?: number }>; required?: string[] };
      };
    };
  };
};

describe("video create shot generation API contract", () => {
  test("publishes the owned script clearing operation", async () => {
    const spec = (await Bun.file(resolve(import.meta.dir, "../../openapi/openapi.json")).json()) as {
      paths: Record<string, Record<string, OpenApiOperation>>;
    };
    const clear = spec.paths["/api/video-create/projects/{projectId}/script"]?.delete;

    expect(clear?.operationId).toBe("clearVideoCreateScript");
    expect(clear?.responses).toHaveProperty("200");
    expect(clear?.responses).toHaveProperty("404");
    expect(clear?.responses).toHaveProperty("409");
  });

  test("publishes the review draft and exact individual submission contract", async () => {
    const spec = (await Bun.file(resolve(import.meta.dir, "../../openapi/openapi.json")).json()) as {
      paths: Record<string, Record<string, OpenApiOperation>>;
    };
    const individual = spec.paths["/api/video-create/projects/{projectId}/shots/{shotId}/generate"]?.post;
    const batch = spec.paths["/api/video-create/projects/{projectId}/shots/batch-generate"]?.post;
    const draft = spec.paths["/api/video-create/projects/{projectId}/shots/{shotId}/generation-draft"]?.get;

    expect(draft?.operationId).toBe("getVideoCreateShotGenerationDraft");
    expect(draft?.responses).toHaveProperty("200");
    expect(draft?.responses).toHaveProperty("404");
    expect(JSON.stringify(draft?.responses?.["200"])).toContain('"generationPlan"');
    expect(JSON.stringify(draft?.responses?.["200"])).toContain('"人物","商品"');
    expect(individual?.operationId).toBe("generateVideoCreateShot");
    expect(batch?.operationId).toBe("batchGenerateVideoCreateShots");
    const individualSchema = individual?.requestBody?.content?.["application/json"]?.schema;
    expect(individualSchema?.required).toEqual([
      "videoModel",
      "ratio",
      "resolution",
      "generateAudio",
      "prompt",
      "duration",
      "referenceMode",
      "references",
      "usePortrait",
    ]);
    expect(individualSchema?.properties).toHaveProperty("portrait");
    expect(individualSchema?.properties?.generateAudio?.type).toBe("boolean");
    expect(individualSchema?.properties?.references?.maxItems).toBe(12);
    expect(JSON.stringify(individualSchema?.properties?.references)).toContain('"人物","商品"');

    const batchSchema = batch?.requestBody?.content?.["application/json"]?.schema;
    expect(batchSchema?.required).toEqual(["videoModel", "ratio", "resolution", "generateAudio"]);
    expect(batchSchema?.properties?.generateAudio?.type).toBe("boolean");
    for (const route of [individual, batch]) {
      expect(route?.responses).toHaveProperty("202");
      expect(route?.responses).toHaveProperty("422");
    }
    expect(individual?.responses).toHaveProperty("409");
    expect(batch?.responses).toHaveProperty("409");
  });

  test("publishes material history, apply, and row-level post-processing operations", async () => {
    const spec = (await Bun.file(resolve(import.meta.dir, "../../openapi/openapi.json")).json()) as {
      paths: Record<string, Record<string, OpenApiOperation>>;
    };
    const history = spec.paths["/api/video-create/projects/{projectId}/shots/{shotId}/material-versions"]?.get;
    const apply =
      spec.paths["/api/video-create/projects/{projectId}/shots/{shotId}/material-versions/{versionId}/apply"]?.post;
    const process = spec.paths["/api/video-create/projects/{projectId}/shots/{shotId}/material-actions/{action}"]?.post;
    const replacement = spec.paths["/api/video-create/projects/{projectId}/shots/{shotId}/replacement"]?.post;

    expect(history?.operationId).toBe("listVideoCreateShotMaterialVersions");
    expect(apply?.operationId).toBe("applyVideoCreateShotMaterialVersion");
    expect(process?.operationId).toBe("processVideoCreateShotMaterial");
    expect(JSON.stringify(process)).toContain('"audio-replace","subtitle-compose"');
    expect(replacement?.requestBody?.content?.["application/json"]?.schema?.required).toEqual(["assetId", "source"]);
    expect(JSON.stringify(replacement)).toContain('"library_replacement","upload_replacement"');
    for (const operation of [history, apply, process]) expect(operation?.responses).toHaveProperty("404");
    expect(apply?.responses).toHaveProperty("409");
    expect(process?.responses).toHaveProperty("202");
    expect(process?.responses).toHaveProperty("409");
  });
});
