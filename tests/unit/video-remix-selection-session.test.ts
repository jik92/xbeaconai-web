import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx"), "utf8");

describe("video remix selection session state", () => {
  test("does not persist unsubmitted product, portrait, or optional voice selections across refreshes", () => {
    expect(page).not.toContain("studio:selectedProduct");
    expect(page).not.toContain("studio:selectedPortrait");
    expect(page).not.toContain("studio:selectedVoice");
    expect(page).toContain("useState<SelectedPortrait[]>([])");
    expect(page).toContain("useState<LibraryProduct | null>(null)");
    expect(page).toContain("useState<LibraryAsset | null>(null)");
  });
});
