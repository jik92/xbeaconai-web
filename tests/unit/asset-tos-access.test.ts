import { describe, expect, test } from "bun:test";
import { mediaAccessUrlForContent } from "../../web/api/api-client";

describe("asset TOS access", () => {
  test("resolves legacy owned media identifiers through CDN authorization routes", () => {
    expect(mediaAccessUrlForContent("/api/assets/123e4567-e89b-12d3-a456-426614174000/content")).toBe(
      "/api/assets/123e4567-e89b-12d3-a456-426614174000/access",
    );
    expect(mediaAccessUrlForContent("/api/artifacts/123e4567-e89b-12d3-a456-426614174000")).toBe(
      "/api/artifacts/123e4567-e89b-12d3-a456-426614174000/access",
    );
    expect(mediaAccessUrlForContent("/api/portraits/123e4567-e89b-12d3-a456-426614174000/content")).toBeUndefined();
  });

  test("publishes protected access routes that return CDN media fields", async () => {
    const source = await Bun.file("server/app.ts").text();
    expect(source).toContain('path: "/api/assets/{assetId}/access"');
    expect(source).toContain('operationId: "getAssetAccess"');
    expect(source).toContain('path: "/api/artifacts/{artifactId}/access"');
    expect(source).toContain('operationId: "getArtifactAccess"');
    expect(source).toContain("publicMediaUrls({");
    expect(source).not.toContain("const expiresSeconds = 15 * 60");
  });
});
