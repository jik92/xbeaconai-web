import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const previewPath = resolve(import.meta.dir, "../../web/features/ai-generate/ai-generate-reference-preview.tsx");
const sharedPreviewPath = resolve(import.meta.dir, "../../web/components/domain/creation-assistant-composer.tsx");

describe("AI creation reference preview", () => {
  test("renders authenticated image and video previews with an optional removal action", async () => {
    const source = await Bun.file(previewPath).text();
    const sharedSource = await Bun.file(sharedPreviewPath).text();

    expect(source).toContain("CreationAssistantReferencePreview");
    expect(sharedSource).toContain("AuthenticatedMedia");
    expect(sharedSource).toContain("reference.url ?? `/api/assets/$" + "{reference.id}/access`");
    expect(sharedSource).toContain("onRemove?.(reference.id)");
    expect(sharedSource).toContain("aria-label={`移除 $" + "{reference.name}`}");
  });
});
