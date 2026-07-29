import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const assetLibraryPath = resolve(import.meta.dir, "../../web/features/asset-library/asset-library.tsx");

describe("voice library layout", () => {
  test("keeps long voice metadata separate from the fixed preview action", async () => {
    const source = await Bun.file(assetLibraryPath).text();

    expect(source).toContain('data-testid="voice-library-row"');
    expect(source).toContain("min-w-0 flex-1");
    expect(source).toContain("h-auto self-stretch");
    expect(source).toContain("shrink-0");
    expect(source).toContain("truncate type-helper text-muted");
  });
});
