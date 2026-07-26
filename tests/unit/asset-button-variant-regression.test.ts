import { describe, expect, test } from "bun:test";

describe("asset and account interactive button variants", () => {
  test("keeps asset cards on a neutral stacked button surface", async () => {
    const assetLibrary = await Bun.file("web/features/asset-library/asset-library.tsx").text();
    const portraitLibrary = await Bun.file("web/features/portrait-library/portrait-library.tsx").text();
    const sceneLibrary = await Bun.file("web/features/scene-library/scene-library.tsx").text();

    expect(assetLibrary).toMatch(
      /<Button\s+variant="ghost"\s+className="library-asset-card flex-col items-stretch justify-start gap-0 whitespace-normal hover:bg-surface"/,
    );
    expect(assetLibrary).toContain(
      'variant="ghost"\n                  className="min-w-0 flex-1 flex-col items-start justify-center gap-0 whitespace-normal text-left"',
    );
    expect(assetLibrary).toContain('variant="ghost"\n            className="media-asset-delete"');
    expect(portraitLibrary).toContain(
      'variant="ghost"\n                    className="portrait-card h-auto w-full flex-col items-stretch justify-start gap-0 whitespace-normal p-0 hover:bg-surface"',
    );
    expect(sceneLibrary).toContain(
      'variant="ghost"\n              className="group h-auto w-full flex-col items-stretch justify-start gap-0 whitespace-normal',
    );
  });

  test("keeps account dropdown actions as full-width neutral menu rows", async () => {
    const shell = await Bun.file("web/components/domain/app-shell.tsx").text();

    expect(shell.match(/role="menuitem"/g) ?? []).toHaveLength(5);
    expect(shell.match(/variant="ghost"\n\s+role="menuitem"/g) ?? []).toHaveLength(3);
    expect(shell.match(/className="flex h-9 w-full items-center justify-start/g) ?? []).toHaveLength(3);
  });

  test("keeps every material folder row aligned with the all-materials row", async () => {
    const folderSpace = await Bun.file("web/features/asset-library/asset-folder-space.tsx").text();

    expect(folderSpace.match(/type="button"\n\s+variant="ghost"/g) ?? []).toHaveLength(2);
    expect(folderSpace).toContain(
      '"flex h-8 w-full items-center justify-start gap-2 rounded-md px-2 text-left type-helper text-muted hover:bg-surface-muted"',
    );
    expect(folderSpace).toContain(
      '"flex h-8 min-w-0 flex-1 items-center justify-start gap-2 rounded-md pr-1 text-left type-helper text-muted hover:bg-surface-muted"',
    );
  });
});
