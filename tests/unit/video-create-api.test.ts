import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

type OpenApiOperation = {
  operationId?: string;
  responses?: Record<string, unknown>;
  requestBody?: {
    content?: {
      "application/json"?: { schema?: { properties?: Record<string, { type?: string }>; required?: string[] } };
    };
  };
};

describe("video create shot generation API contract", () => {
  test("publishes shared settings for individual and batch shot generation", async () => {
    const spec = (await Bun.file(resolve(import.meta.dir, "../../openapi/openapi.json")).json()) as {
      paths: Record<string, Record<string, OpenApiOperation>>;
    };
    const individual = spec.paths["/api/video-create/projects/{projectId}/shots/{shotId}/generate"]?.post;
    const batch = spec.paths["/api/video-create/projects/{projectId}/shots/batch-generate"]?.post;

    expect(individual?.operationId).toBe("generateVideoCreateShot");
    expect(batch?.operationId).toBe("batchGenerateVideoCreateShots");
    for (const route of [individual, batch]) {
      const schema = route?.requestBody?.content?.["application/json"]?.schema;
      expect(schema?.required).toEqual(["videoModel", "ratio", "resolution", "generateAudio"]);
      expect(schema?.properties?.generateAudio?.type).toBe("boolean");
      expect(route?.responses).toHaveProperty("202");
      expect(route?.responses).toHaveProperty("422");
    }
    expect(individual?.responses).toHaveProperty("409");
    expect(batch?.responses).toHaveProperty("409");
  });
});
