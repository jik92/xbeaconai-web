import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("admin user API contract", () => {
  test("publishes list, idempotent credit grant and status update routes", async () => {
    const spec = (await Bun.file(resolve(import.meta.dir, "../../openapi/openapi.json")).json()) as {
      paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, unknown> }>>;
    };

    expect(spec.paths["/api/admin/users"]?.get?.operationId).toBe("listAdminUsers");
    expect(spec.paths["/api/admin/users/{userId}/credits"]?.post?.operationId).toBe("grantAdminUserCredits");
    expect(spec.paths["/api/admin/users/{userId}/credits"]?.post?.responses).toHaveProperty("409");
    expect(spec.paths["/api/admin/users/{userId}/status"]?.patch?.operationId).toBe("updateAdminUserStatus");
  });
});
