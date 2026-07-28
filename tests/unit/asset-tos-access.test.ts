import { describe, expect, test } from "bun:test";
import { assetAccessUrlForContent } from "../../web/api/api-client";

describe("asset TOS access", () => {
  test("resolves owned asset content through a separate signed-url authorization route", () => {
    expect(assetAccessUrlForContent("/api/assets/123e4567-e89b-12d3-a456-426614174000/content")).toBe(
      "/api/assets/123e4567-e89b-12d3-a456-426614174000/access",
    );
    expect(assetAccessUrlForContent("/api/portraits/123e4567-e89b-12d3-a456-426614174000/content")).toBeUndefined();
  });

  test("publishes a protected asset access route without returning permanent object access", async () => {
    const source = await Bun.file("server/app.ts").text();
    expect(source).toContain('path: "/api/assets/{assetId}/access"');
    expect(source).toContain('operationId: "getAssetAccess"');
    expect(source).toContain("const expiresSeconds = 15 * 60");
    expect(source).toContain("ossutils.createSignedReadUrl(asset.storageKey, expiresSeconds)");
  });
});
