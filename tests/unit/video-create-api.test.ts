import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("video create batch API contract", () => {
  test("publishes independent batch shot generation", async () => {
    const spec = (await Bun.file(resolve(import.meta.dir, "../../openapi/openapi.json")).json()) as {
      paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, unknown> }>>;
    };
    const route = spec.paths["/api/video-create/projects/{projectId}/shots/batch-generate"]?.post;
    expect(route?.operationId).toBe("batchGenerateVideoCreateShots");
    expect(route?.responses).toHaveProperty("202");
    expect(route?.responses).toHaveProperty("409");
    expect(route?.responses).toHaveProperty("422");
  });
});
