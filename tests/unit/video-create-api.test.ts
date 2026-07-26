import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
  test("publishes searchable paginated records and title-only rename", async () => {
    const spec = (await Bun.file(resolve(import.meta.dir, "../../openapi/openapi.json")).json()) as {
      paths: Record<string, Record<string, OpenApiOperation & { parameters?: unknown }>>;
    };
    const list = spec.paths["/api/video-create/projects"]?.get;
    const update = spec.paths["/api/video-create/projects/{projectId}"]?.patch;
    expect(JSON.stringify(list?.parameters)).toContain('"query"');
    expect(JSON.stringify(list?.parameters)).toContain('"status"');
    expect(JSON.stringify(list?.parameters)).toContain('"pageSize"');
    expect(JSON.stringify(list?.responses?.["200"])).toContain('"total"');
    expect(JSON.stringify(update?.requestBody)).toContain('"title"');
    expect(JSON.stringify(update?.requestBody)).toContain('"expectedVersion"');
  });

  test("publishes the persistent full-generation action and workflow state", async () => {
    const spec = (await Bun.file(resolve(import.meta.dir, "../../openapi/openapi.json")).json()) as {
      paths: Record<string, Record<string, OpenApiOperation>>;
      components?: { schemas?: Record<string, unknown> };
    };
    const action = spec.paths["/api/video-create/projects/{projectId}/actions/{action}"]?.post;
    expect(JSON.stringify(action)).toContain('"full"');
    expect(JSON.stringify(spec.components?.schemas?.VideoCreateProject)).toContain('"autoGenerate"');
    expect(JSON.stringify(spec.components?.schemas?.VideoCreateProject)).toContain('"autoGenerateRunId"');
  });
  test("publishes project media settings, voice preview, and batch audio operations", () => {
    const document = JSON.parse(readFileSync(resolve(import.meta.dir, "../../openapi/openapi.json"), "utf8")) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
    };
    expect(document.paths["/api/video-create/projects/{projectId}/media-settings"]?.patch?.operationId).toBe(
      "updateVideoCreateMediaSettings",
    );
    expect(document.paths["/api/video-create/voice-preview"]?.post?.operationId).toBe("previewVideoCreateVoice");
    expect(document.paths["/api/video-create/projects/{projectId}/shots/batch-audio"]?.post?.operationId).toBe(
      "batchGenerateVideoCreateAudio",
    );
  });
  test("publishes the owned script clearing operation", async () => {
    const spec = (await Bun.file(resolve(import.meta.dir, "../../openapi/openapi.json")).json()) as {
      paths: Record<string, Record<string, OpenApiOperation>>;
      components?: { schemas?: Record<string, unknown> };
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
      components?: { schemas?: Record<string, unknown> };
    };
    const history = spec.paths["/api/video-create/projects/{projectId}/shots/{shotId}/material-versions"]?.get;
    const apply =
      spec.paths["/api/video-create/projects/{projectId}/shots/{shotId}/material-versions/{versionId}/apply"]?.post;
    const process = spec.paths["/api/video-create/projects/{projectId}/shots/{shotId}/material-actions/{action}"]?.post;
    const replacement = spec.paths["/api/video-create/projects/{projectId}/shots/{shotId}/replacement"]?.post;

    expect(history?.operationId).toBe("listVideoCreateShotMaterialVersions");
    expect(JSON.stringify(history?.responses?.["200"])).toContain('"subtitlesComposed"');
    expect(JSON.stringify(history?.responses?.["200"])).toContain('"generation"');
    expect(JSON.stringify(history?.responses?.["200"])).toContain('"execution"');
    expect(JSON.stringify(history?.responses?.["200"])).toContain('"generateAudio"');
    expect(JSON.stringify(history?.responses?.["200"])).toContain('"submittedAt"');
    expect(JSON.stringify(spec.components?.schemas?.VideoCreateProject)).toContain('"subtitlesComposed"');
    expect(apply?.operationId).toBe("applyVideoCreateShotMaterialVersion");
    expect(process?.operationId).toBe("processVideoCreateShotMaterial");
    expect(JSON.stringify(process)).toContain('"audio-replace","subtitle-compose"');
    expect(replacement?.requestBody?.content?.["application/json"]?.schema?.required).toEqual(["assetId", "source"]);
    expect(JSON.stringify(replacement)).toContain('"library_replacement","upload_replacement"');
    for (const operation of [history, apply, process]) expect(operation?.responses).toHaveProperty("404");
    expect(apply?.responses).toHaveProperty("409");
    expect(process?.responses).toHaveProperty("202");
    expect(process?.responses).toHaveProperty("409");
    const app = readFileSync(resolve(import.meta.dir, "../../server/app.ts"), "utf8");
    expect(app).toContain('store.getOwned(version.jobId, c.get("userId"))');
  });
});
