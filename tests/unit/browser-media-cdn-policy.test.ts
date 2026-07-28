import { describe, expect, test } from "bun:test";
import { directMediaSource } from "../../web/api/api-client";

describe("browser media CDN policy", () => {
  test("accepts only the exact media CDN as a native media source", () => {
    expect(directMediaSource("https://files.xbeaconai.com/system/portraits/3.png")).toBe(
      "https://files.xbeaconai.com/system/portraits/3.png",
    );
    expect(directMediaSource("https://api.xbeaconai.com/api/portraits/3/content")).toBeUndefined();
    expect(directMediaSource("/api/assets/00000000-0000-4000-8000-000000000000/content")).toBeUndefined();
    expect(directMediaSource("data:image/png;base64,AAAA")).toBeUndefined();
    expect(directMediaSource("https://third-party.example/image.png")).toBeUndefined();
  });

  test("keeps browser code free of legacy binary media identifiers and inline media", async () => {
    const violations: string[] = [];
    const forbidden = [
      /\/api\/assets\/[^\n"'`]*\/content/g,
      /\/api\/portraits\/[^\n"'`]*\/content/g,
      /\/api\/artifacts\/\$\{[^}]+}(?!\/access)/g,
      /data:(?:image|audio|video)\//g,
    ];
    for (const file of new Bun.Glob("web/**/*.{ts,tsx}").scanSync()) {
      if (file.startsWith("web/api/generated/")) continue;
      const source = await Bun.file(file).text();
      for (const pattern of forbidden)
        for (const match of source.matchAll(pattern)) violations.push(`${file}: ${match[0]}`);
    }
    expect(violations).toEqual([]);
  });

  test("does not publish legacy browser media binary routes", async () => {
    const spec = (await Bun.file("openapi/openapi.json").json()) as { paths: Record<string, unknown> };
    expect(spec.paths["/api/portraits/{portraitId}/content"]).toBeUndefined();
    expect(spec.paths["/api/assets/{assetId}/content"]).toBeUndefined();
    expect(spec.paths["/api/artifacts/{artifactId}"]).toBeUndefined();
    expect(spec.paths["/api/assets/{assetId}/access"]).toBeDefined();
    expect(spec.paths["/api/artifacts/{artifactId}/access"]).toBeDefined();
  });
});
