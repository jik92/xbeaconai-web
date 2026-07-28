import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const previewPath = resolve(import.meta.dir, "../../web/features/ai-generate/ai-generate-reference-preview.tsx");

describe("AI creation reference preview", () => {
  test("renders authenticated image and video previews with an optional removal action", async () => {
    const source = await Bun.file(previewPath).text();

    expect(source).toContain("AuthenticatedMedia");
    expect(source).toContain("reference.url ?? `/api/assets/${reference.id}/content`");
    expect(source).toContain("onRemove?.(reference.id)");
    expect(source).toContain("aria-label={`移除 ${reference.name}`}");
  });
});
