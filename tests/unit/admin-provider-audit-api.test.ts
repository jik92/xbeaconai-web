import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

type Operation = {
  operationId?: string;
  parameters?: Array<{ name?: string; in?: string }>;
  responses?: Record<string, { content?: Record<string, unknown> }>;
};

describe("admin provider generation audit API contract", () => {
  test("publishes administrator-only list and CDN-backed generated material detail", async () => {
    const spec = (await Bun.file(resolve(import.meta.dir, "../../openapi/openapi.json")).json()) as {
      paths: Record<string, Record<string, Operation>>;
    };

    const list = spec.paths["/api/admin/provider-audits"]?.get;
    const detail = spec.paths["/api/admin/provider-audits/{auditId}"]?.get;
    const asset = spec.paths["/api/admin/provider-audits/{auditId}/assets/{assetId}"]?.get;
    expect(list?.operationId).toBe("listAdminProviderAudits");
    expect(list?.parameters?.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        "page",
        "pageSize",
        "query",
        "provider",
        "moduleId",
        "status",
        "startedFrom",
        "startedTo",
      ]),
    );
    expect(list?.responses).toHaveProperty("403");
    expect(detail?.operationId).toBe("getAdminProviderAudit");
    expect(detail?.responses).toHaveProperty("404");
    expect(asset).toBeUndefined();
    expect(JSON.stringify(detail?.responses?.["200"])).toContain('"thumbnailUrl"');
    expect(JSON.stringify(detail?.responses?.["200"])).toContain('"originalUrl"');
    expect(JSON.stringify(detail?.responses?.["200"])).not.toContain("application/octet-stream");
  });
});
