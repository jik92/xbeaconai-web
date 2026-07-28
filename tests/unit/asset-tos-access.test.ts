import { describe, expect, test } from "bun:test";
import { mediaAccessUrl } from "../../web/api/api-client";

describe("asset TOS access", () => {
  test("accepts only explicit CDN authorization routes as protected media identifiers", () => {
    expect(mediaAccessUrl("/api/assets/123e4567-e89b-12d3-a456-426614174000/access")).toBe(
      "/api/assets/123e4567-e89b-12d3-a456-426614174000/access",
    );
    expect(mediaAccessUrl("/api/artifacts/123e4567-e89b-12d3-a456-426614174000/access")).toBe(
      "/api/artifacts/123e4567-e89b-12d3-a456-426614174000/access",
    );
    expect(mediaAccessUrl("/api/assets/123e4567-e89b-12d3-a456-426614174000/content")).toBeUndefined();
    expect(mediaAccessUrl("/api/artifacts/123e4567-e89b-12d3-a456-426614174000")).toBeUndefined();
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
