# AI Creation Real Image Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every Mock image model in AI 创作 with a verified real AIHubMix-backed implementation and remove the nonexistent Seedream 5 Pro entry.

**Architecture:** A typed image-model catalog is the single source of truth for UI capabilities, API validation, Provider routing, and Worker provenance. The Provider normalizes OpenAI Images, AIHubMix Predictions, and Gemini image responses into one result shape; the Worker prepares protocol-specific references and persists only real outputs.

**Tech Stack:** Bun, TypeScript strict, Hono/Zod OpenAPI, `@google/genai` 2.x, Bun Test, AIHubMix OpenAI/Predictions/Gemini APIs.

## Global Constraints

- Delete `seedream-5-pro`; never alias it to another model.
- Every remaining image model must publish `executionMode: "real"` and must never fall back to Mock or another model.
- Keep stable product-side IDs while sending exact official Provider model IDs.
- Do not manually edit generated OpenAPI/SDK files.
- Preserve owner isolation for reference assets and generated artifacts.
- Do not run E2E.

---

### Task 1: Typed real image-model catalog

**Files:**
- Create: `server/creation/image-models.ts`
- Modify: `server/creation/capabilities.ts`
- Test: `tests/unit/creation-capabilities.test.ts`

**Interfaces:**
- Produces: `ImageModelId`, `ImageProviderProtocol`, `ImageModelDefinition`, `imageModelDefinitions`, `getImageModelDefinition(id)`.
- Consumes: existing `CreationModelCapability`.

- [ ] **Step 1: Write the failing model-directory test**

Assert that the image capability IDs are exactly the seven approved product IDs, no item uses Mock, every model has a Provider mapping, and GPT Image 2 requires a reference:

```ts
expect(imageModels.map((model) => model.id)).toEqual([
  "gpt-image-1-mini",
  "seedream-5-lite",
  "seedream-4-5",
  "seedream-4-0",
  "nano-banana-2",
  "nano-banana-pro",
  "gpt-image-2-stable",
]);
expect(imageModels.every((model) => model.executionMode === "real")).toBeTrue();
expect(imageModels.find((model) => model.id === "gpt-image-2-stable")?.minReferences).toBe(1);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `bun test tests/unit/creation-capabilities.test.ts`

Expected: FAIL because seven entries are still Mock, `seedream-5-pro` exists, and `minReferences` is absent.

- [ ] **Step 3: Implement the typed catalog**

Create definitions with stable and Provider IDs:

```ts
export type ImageProviderProtocol = "openai-images" | "aihubmix-predictions" | "gemini-interactions" | "gemini-content";

export interface ImageModelDefinition {
  id: ImageModelId;
  providerModel: string;
  protocol: ImageProviderProtocol;
  minReferences: number;
  maxReferences: number;
  capability: CreationModelCapability;
}

export function getImageModelDefinition(id: string) {
  return imageModelDefinitions.find((model) => model.id === id);
}
```

Populate exact mappings:

```ts
["seedream-5-lite", "doubao-seedream-5.0-lite", "aihubmix-predictions"]
["seedream-4-5", "doubao-seedream-4-5", "aihubmix-predictions"]
["seedream-4-0", "doubao-seedream-4-0", "aihubmix-predictions"]
["nano-banana-2", "gemini-3.1-flash-image", "gemini-interactions"]
["nano-banana-pro", "gemini-3-pro-image-preview", "gemini-content"]
["gpt-image-2-stable", "gpt-image-2", "openai-images"]
["gpt-image-1-mini", "gpt-image-1-mini", "openai-images"]
```

Extend `CreationModelCapability` with `minReferences` and `maxReferences`, and derive image capabilities entirely from this catalog.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `bun test tests/unit/creation-capabilities.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/creation/image-models.ts server/creation/capabilities.ts tests/unit/creation-capabilities.test.ts
git commit -m "feat: publish real image model catalog"
```

### Task 2: Provider adapters for Seedream and Gemini

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `server/providers/aihubmix.ts`
- Test: `tests/unit/aihubmix-image.test.ts`

**Interfaces:**
- Consumes: `ImageProviderProtocol` and official Provider model IDs.
- Produces:
  `generateSeedreamImages(input: AihubmixPredictionImageInput): Promise<AihubmixImageResult[]>`,
  `generateGeminiInteractionImages(input: AihubmixGeminiImageInput): Promise<AihubmixImageResult[]>`,
  `generateGeminiContentImages(input: AihubmixGeminiImageInput): Promise<AihubmixImageResult[]>`.

- [ ] **Step 1: Add failing Seedream request/response tests**

Use an injected fetch function and assert:

```ts
expect(url).toBe("https://aihubmix.example.test/v1/models/doubao/doubao-seedream-4-5/predictions");
expect(JSON.parse(String(init?.body))).toEqual({
  input: {
    model: "doubao-seedream-4-5",
    prompt: "replace the coat",
    image: ["https://signed.example/front.png", "https://signed.example/coat.png"],
    size: "2K",
    sequential_image_generation: "disabled",
    response_format: "url",
    watermark: false,
  },
});
```

Cover both `{ output: ["https://..."] }` and OpenAI-shaped `{ data: [{ url: "https://..." }] }` normalization, rejecting empty output.

- [ ] **Step 2: Run the Seedream test and verify RED**

Run: `bun test tests/unit/aihubmix-image.test.ts`

Expected: FAIL because `generateSeedreamImages` does not exist.

- [ ] **Step 3: Implement the Seedream Predictions adapter**

Add a typed input containing `model`, `prompt`, `size`, `count`, and `imageUrls`. Submit exactly one mutating POST and normalize URL/Base64 outputs without retrying the paid request.

- [ ] **Step 4: Run the Seedream test and verify GREEN**

Run: `bun test tests/unit/aihubmix-image.test.ts`

Expected: PASS.

- [ ] **Step 5: Add failing Gemini tests**

Add `@google/genai` at version `^2.0.0`, but inject a narrow Gemini client in tests. Assert Nano Banana 2 receives:

```ts
{
  model: "gemini-3.1-flash-image",
  input: [{ type: "text", text: "studio product photo" }],
  response_modalities: ["text", "image"],
  response_format: { type: "image", aspect_ratio: "1:1", image_size: "1K" },
}
```

Assert Nano Banana Pro receives non-streaming `generateContent` parts with text and optional `inlineData`, uppercase `1K/2K/4K`, and extracts every returned image part.

- [ ] **Step 6: Run the Gemini tests and verify RED**

Run: `bun test tests/unit/aihubmix-image.test.ts`

Expected: FAIL because the Gemini adapter methods do not exist.

- [ ] **Step 7: Implement Gemini adapters**

Construct `GoogleGenAI` with the existing AIHubMix key and `{ baseUrl: "<base>/gemini" }`. Reject reference payloads above the existing 20 MB inline limit, malformed Base64, and responses without image data.

- [ ] **Step 8: Run Provider tests and verify GREEN**

Run: `bun test tests/unit/aihubmix-image.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add package.json bun.lock server/providers/aihubmix.ts tests/unit/aihubmix-image.test.ts
git commit -m "feat: add Seedream and Gemini image providers"
```

### Task 3: Protocol-aware Worker execution

**Files:**
- Modify: `worker/jobs/job-ai-generate.ts`
- Modify: `tests/integration/ai-generate-worker-isolated.test.ts`
- Test: `tests/unit/ai-generate-worker.test.ts`

**Interfaces:**
- Consumes: `getImageModelDefinition`, normalized `AihubmixImageResult[]`, owned `MediaAsset`s.
- Produces: real image artifacts whose provenance model is the exact Provider model ID.

- [ ] **Step 1: Write failing Worker routing tests**

Extend the injected image client to capture `generateImages`, `editImages`, `generateSeedreamImages`,
`generateGeminiInteractionImages`, and `generateGeminiContentImages`. Add one test per protocol:

```ts
expect(seedreamCalls[0]).toMatchObject({
  model: "doubao-seedream-4-5",
  imageUrls: ["https://signed.example/reference.png"],
  size: "2K",
});
expect(geminiInteractionCalls[0]).toMatchObject({ model: "gemini-3.1-flash-image", aspectRatio: "1:1" });
expect(geminiContentCalls[0]).toMatchObject({ model: "gemini-3-pro-image-preview", imageSize: "2K" });
expect(openAiEditCalls[0]).toMatchObject({ model: "gpt-image-2" });
```

Assert no Mock artifact or fallback call exists and lineage records the Provider model ID.

- [ ] **Step 2: Run Worker tests and verify RED**

Run: `bun test tests/unit/ai-generate-worker.test.ts`

Expected: FAIL because the Worker always forwards the product ID to OpenAI Images.

- [ ] **Step 3: Implement protocol-aware routing**

Resolve the definition before any paid request. Load byte references for OpenAI/Gemini and short-lived signed read URLs for Seedream:

```ts
switch (definition.protocol) {
  case "openai-images":
    return references.length ? imageClient.editImages(openAiInput) : imageClient.generateImages(openAiInput);
  case "aihubmix-predictions":
    return imageClient.generateSeedreamImages(predictionInput);
  case "gemini-interactions":
    return imageClient.generateGeminiInteractionImages(geminiInput);
  case "gemini-content":
    return imageClient.generateGeminiContentImages(geminiInput);
}
```

Use `definition.providerModel` for the upstream request and provenance. Keep cancellation checks before and after the paid call, response decoding, artifact ownership, and error redaction.

- [ ] **Step 4: Run Worker tests and verify GREEN**

Run:

```bash
bun test tests/unit/ai-generate-worker.test.ts
bun test tests/unit/worker-job-registry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/jobs/job-ai-generate.ts tests/integration/ai-generate-worker-isolated.test.ts tests/unit/ai-generate-worker.test.ts
git commit -m "feat: route AI image jobs by provider protocol"
```

### Task 4: API and frontend capability enforcement

**Files:**
- Modify: `server/app.ts`
- Modify: `web/features/ai-generate/ai-generate-page.tsx`
- Modify: `tests/integration/ai-generate-api-isolated.test.ts`
- Modify: `tests/unit/ai-generate-api.test.ts`
- Modify: `tests/unit/ai-generate-page.test.ts`

**Interfaces:**
- Consumes: `CreationModelCapability.minReferences`, `.maxReferences`, and existing `referenceAssetIds`.
- Produces: early structured rejection for unsupported reference counts and a disabled submit state in the composer.

- [ ] **Step 1: Write failing API capability tests**

Assert the capability response contains seven real image models and no `seedream-5-pro`. Submit GPT Image 2 without a reference and expect:

```ts
expect(response.status).toBe(422);
expect(await response.json()).toMatchObject({
  error: { code: "INVALID_AI_GENERATE_CONFIG", message: "该模型至少需要 1 张参考图" },
});
```

Also submit more references than a model supports and expect a 422 before credits or queue mutation.

- [ ] **Step 2: Run API tests and verify RED**

Run: `bun test tests/unit/ai-generate-api.test.ts`

Expected: FAIL because reference counts are not part of capability validation.

- [ ] **Step 3: Implement API reference-count validation**

Add `referenceCount` to the values passed into `validateCreationValues`, check `minReferences`/`maxReferences`, and add both fields to `creationModelSchema`. Keep MIME and ownership checks after capability validation and before charging.

- [ ] **Step 4: Run API tests and verify GREEN**

Run: `bun test tests/unit/ai-generate-api.test.ts`

Expected: PASS.

- [ ] **Step 5: Write and satisfy the frontend test**

Update the page test to assert model options no longer display `Mock` and `Seedream 5 Pro` is absent. Disable submission with the API-compatible reference-count message when the selected model requires a reference. Re-run:

Run:

```bash
bun test tests/unit/ai-generate-page.test.ts
bun test tests/unit/ai-generate-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/app.ts web/features/ai-generate/ai-generate-page.tsx tests/integration/ai-generate-api-isolated.test.ts tests/unit/ai-generate-api.test.ts tests/unit/ai-generate-page.test.ts
git commit -m "feat: enforce real image model capabilities"
```

### Task 5: Generated contract and completion verification

**Files:**
- Modify (generated): `openapi/openapi.json`
- Modify (generated): `web/api/generated/`
- Modify: `server/sdk-registry.ts`
- Modify: `scripts/test-models.ts`
- Modify: `docs/superpowers/plans/2026-07-26-ai-creation-real-image-models.md`

**Interfaces:**
- Consumes: final API schema and exact Provider model IDs.
- Produces: regenerated SDK, model doctor coverage, and checked-off implementation record.

- [ ] **Step 1: Add registry/doctor coverage**

Publish separate image registry entries for the three protocol families so verification evidence identifies the exact real model path rather than treating GPT Image 1 Mini as proof for every model.

- [ ] **Step 2: Regenerate API artifacts**

Run:

```bash
bun run api:spec
bun run api:generate
```

Expected: generated capability types include `minReferences` and `maxReferences`; no generated file is hand-edited.

- [ ] **Step 3: Run focused verification**

Run:

```bash
bun test tests/unit/creation-capabilities.test.ts tests/unit/aihubmix-image.test.ts tests/unit/ai-generate-api.test.ts tests/unit/ai-generate-worker.test.ts tests/unit/ai-generate-page.test.ts tests/unit/ai-generate-runtime.test.ts tests/unit/worker-job-registry.test.ts
bun run typecheck
bun run build
```

Expected: all commands PASS.

- [ ] **Step 4: Run the repository baseline**

Run:

```bash
make ci
bun run typecheck
bun run build
```

Expected: image-model work passes. If the two previously observed FFmpeg failures remain, record their exact unchanged output and do not modify unrelated video/subtitle code.

- [ ] **Step 5: Audit the completed scope**

Run:

```bash
rg -n "seedream-5-pro|executionMode: \"mock\"|尚未接入真实 Provider" server/creation web/features/ai-generate
git diff --check
git status --short
```

Expected: no Mock image model or removed model remains; only intended source/generated files and the pre-existing `.DS_Store` appear.

- [ ] **Step 6: Mark this plan complete and commit**

Check every completed box in this file, then:

```bash
git add docs/superpowers/plans/2026-07-26-ai-creation-real-image-models.md openapi/openapi.json web/api/generated server/sdk-registry.ts scripts/test-models.ts
git commit -m "chore: verify real AI image models"
```

- [ ] **Step 7: Push the branch**

Run:

```bash
git push origin agent/assistant-ui-ai-generate
```

Expected: the remote branch advances to the final implementation commit.
