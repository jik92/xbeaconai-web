import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const page = readFileSync(resolve(import.meta.dir, "../../web/features/video-remix/remix-project.tsx"), "utf8");

describe("video remix selection session state", () => {
  test("does not persist unsubmitted product or portrait selections across refreshes", () => {
    expect(page).not.toContain("studio:selectedProduct");
    expect(page).not.toContain("studio:selectedPortrait");
    expect(page).toContain("useState<SelectedPortrait[]>([])");
    expect(page).toContain("useState<LibraryProduct | null>(null)");
  });
});
