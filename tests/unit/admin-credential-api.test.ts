import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("admin credential API contract", () => {
  test("publishes fill-missing import and plaintext export routes without requiring an import filename", async () => {
    const spec = (await Bun.file(resolve(import.meta.dir, "../../openapi/openapi.json")).json()) as {
      paths: Record<
        string,
        Record<string, { operationId?: string; responses?: Record<string, { content?: Record<string, unknown> }> }>
      >;
    };
    const appSource = await Bun.file(resolve(import.meta.dir, "../../server/app.ts")).text();

    expect(spec.paths["/api/admin/credentials/export"]?.get?.operationId).toBe("exportAdminEnvKey");
    expect(spec.paths["/api/admin/credentials/export"]?.get?.responses?.["200"]?.content).toHaveProperty("text/plain");
    expect(spec.paths["/api/admin/credentials/import"]?.post?.operationId).toBe("importAdminEnvKey");
    expect(appSource).toContain("providerCredentials.setMissing(parsed.values");
    expect(appSource).toContain("docsUrl: z.string().url()");
    expect(appSource).toContain('c.header("Cache-Control", "no-store")');
    expect(appSource).not.toContain('file.name !== ".env.key"');
  });
});
