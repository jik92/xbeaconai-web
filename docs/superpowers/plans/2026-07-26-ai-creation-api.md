# AI Creation API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic AI creation job submission and execution path with a typed API and a dedicated real-provider Worker workflow for AIHubMix images and Ark Seedance videos.

**Architecture:** A dedicated Hono OpenAPI route validates a discriminated image/video request, normalizes it into the existing persisted Job contract, charges credits, and enqueues BullMQ. A dedicated Worker handler consumes only `ai-generate` jobs, dispatches image requests to AIHubMix generations/edits and video requests to the existing `SeedanceVideoJob`, then persists authenticated artifacts without Mock fallback.

**Tech Stack:** Bun, TypeScript strict, Hono OpenAPI/Zod, Drizzle-backed Job and Account stores, BullMQ, AIHubMix Images API, Ark Seedance, generated `@hey-api/openapi-ts` SDK, assistant-ui.

## Global Constraints

- Keep API Server, Worker, and Web as separate processes.
- Use Drizzle-backed stores; do not add raw SQL or process-local job state.
- Never trust a client-provided owner ID, Provider, execution mode, or price.
- Preserve idempotency, owner isolation, cancellation, recovery, credit charging, and authenticated artifact URLs.
- Do not silently fall back to Mock.
- Do not manually edit `web/api/generated/`, `openapi/openapi.json`, or `drizzle/meta/`.
- Default verification excludes E2E and real paid Provider calls.

---

### Task 1: Typed AI creation request contract

**Files:**
- Create: `server/creation/ai-generate-contract.ts`
- Modify: `server/creation/capabilities.ts`
- Test: `tests/unit/ai-generate-contract.test.ts`

**Interfaces:**
- Produces: `AiGenerateRequestSchema`, `AiGenerateRequest`, `normalizeAiGenerateValues(request)`, `parseAiGenerateJobValues(values)`, and `validateAiGenerateReferences(request, models)`.
- Consumes: `CreationModelCapability` and existing capability validation.

- [ ] **Step 1: Write the failing contract tests**

Test that image and video payloads parse into explicit fields, invalid cross-kind fields fail, normalized values round-trip, and reference IDs are UUID strings without client-controlled Provider or execution fields.

```ts
const image = AiGenerateRequestSchema.parse({
  kind: "image",
  title: "商品主图",
  prompt: "白色摄影棚",
  modelId: "gpt-image-1-mini",
  ratio: "1:1",
  resolution: "1k",
  count: 1,
  referenceAssetIds: [assetId],
  revisionMode: "new",
});
expect(parseAiGenerateJobValues(normalizeAiGenerateValues(image))).toEqual(image);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `bun test tests/unit/ai-generate-contract.test.ts`

Expected: FAIL because `server/creation/ai-generate-contract.ts` does not exist.

- [ ] **Step 3: Implement the schema and normalization**

Use `z.discriminatedUnion("kind", [...])`; share title, prompt, model, ratio, resolution, references, optional parent, and revision fields. Encode persisted arrays as JSON and reject unknown keys with `.strict()`.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `bun test tests/unit/ai-generate-contract.test.ts`

Expected: all contract tests pass.

### Task 2: AIHubMix image generation and editing contract

**Files:**
- Modify: `server/providers/aihubmix.ts`
- Test: `tests/unit/aihubmix-image.test.ts`

**Interfaces:**
- Produces:
  - `generateImages(input: { prompt; model; size; count; quality? })`
  - `editImages(input: { prompt; model; size; images: Array<{ bytes; mimeType; name }>; count; quality? })`
  - normalized `Array<{ b64Json?: string; url?: string; revisedPrompt?: string }>`

- [ ] **Step 1: Write failing Provider request tests**

Use a local fetch stub to assert generations sends JSON to `/v1/images/generations`, edits sends multipart to `/v1/images/edits`, POST is issued once, and invalid empty results throw `AIHUBMIX_INVALID_IMAGE_RESULT`.

- [ ] **Step 2: Run the test and verify RED**

Run: `bun test tests/unit/aihubmix-image.test.ts`

Expected: FAIL because the new methods and request shapes do not exist.

- [ ] **Step 3: Implement minimal Provider methods**

Map `b64_json`, `url`, and `revised_prompt` to a shared camel-case result. Put every reference image into `FormData` as `image[]`; append model, prompt, size, `n`, and quality. Keep paid POST requests non-retrying.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `bun test tests/unit/aihubmix-image.test.ts`

Expected: all Provider tests pass.

### Task 3: Dedicated authenticated API route

**Files:**
- Modify: `server/app.ts`
- Test: `tests/unit/ai-generate-api.test.ts`

**Interfaces:**
- Produces OpenAPI operation `createAiGenerateJob` at `POST /api/ai-generate/jobs`.
- Consumes `AiGenerateRequestSchema`, capability catalog, AccountStore, JobStore, and Bull job queue.

- [ ] **Step 1: Write failing API integration tests**

Start the app with isolated stores and assert:

```ts
expect(await post(validImage)).toMatchObject({ status: 202 });
expect(queue.lastJobId).toBe(job.id);
expect(job.values.referenceAssetIds).toBe(JSON.stringify([assetId]));
```

Also assert 422 for unowned/wrong-MIME references, invalid parent, unsupported capability and insufficient credits; assert repeated idempotency key returns one Job.

- [ ] **Step 2: Run the test and verify RED**

Run: `bun test tests/unit/ai-generate-api.test.ts`

Expected: FAIL with route not found.

- [ ] **Step 3: Implement the route**

Validate feature/Provider availability, capability constraints, references and parent ownership before charging. Persist normalized values, `allowMockFallback: "false"`, optional `videoModel`, and real-only execution metadata; charge via `createCharged`, enqueue, return 202.

- [ ] **Step 4: Exclude AI creation from the generic route**

Return `DEDICATED_WORKFLOW_REQUIRED` when `/api/ai-generate/jobs` is reached through the generic `/{moduleId}` handler to prevent two diverging contracts.

- [ ] **Step 5: Run the test and verify GREEN**

Run: `bun test tests/unit/ai-generate-api.test.ts`

Expected: all API tests pass.

### Task 4: Dedicated Worker handler

**Files:**
- Create: `worker/jobs/job-ai-generate.ts`
- Modify: `worker/jobs/registry.ts`
- Modify: `worker/jobs/job-generic-creation.ts`
- Test: `tests/unit/ai-generate-worker.test.ts`
- Modify: `tests/unit/worker-job-registry.test.ts`

**Interfaces:**
- Produces `aiGenerateJob: WorkerJobHandler` with `name: "ai-generate"`.
- Consumes normalized values, `AihubmixClient`, `SeedanceVideoJob`, AccountStore, JobStore, and artifact persistence.

- [ ] **Step 1: Write failing registry and Worker tests**

Assert registry dispatches `ai-generate` to the dedicated handler. With injected Provider seams, assert image without references uses generations, image with references materializes owned files and uses edits, video delegates to Seedance, and Provider failure ends in a structured failed Job without Mock artifact.

- [ ] **Step 2: Run the tests and verify RED**

Run: `bun test tests/unit/ai-generate-worker.test.ts tests/unit/worker-job-registry.test.ts`

Expected: FAIL because `aiGenerateJob` is not registered and generic fallback is selected.

- [ ] **Step 3: Implement image execution**

Resolve owned assets, enforce image MIME and size limits again, materialize them in `mkdtemp`, call the matching AIHubMix method, decode/download every result, write files under `.data/results`, create Artifact records, and clean temporary inputs in `finally`.

- [ ] **Step 4: Implement video execution**

Call `SeedanceVideoJob.execute(job, model)`, preserve Provider task fields and cancellation semantics, probe output, persist the result, and copy Provider provenance to the final artifact.

- [ ] **Step 5: Register before fallback and remove generic AI generation**

Insert `aiGenerateJob` before all generic handlers. Make `genericCreationJob.supports` return false for `ai-generate` so missing registration fails loudly.

- [ ] **Step 6: Run tests and verify GREEN**

Run: `bun test tests/unit/ai-generate-worker.test.ts tests/unit/worker-job-registry.test.ts`

Expected: all dedicated Worker tests pass.

### Task 5: Generated SDK and assistant-ui submission

**Files:**
- Generated: `openapi/openapi.json`
- Generated: `web/api/generated/*`
- Modify: `web/api/api-client.ts`
- Modify: `web/features/ai-generate/ai-generate-runtime.ts`
- Modify: `web/features/ai-generate/ai-generate-page.tsx`
- Modify: `tests/unit/ai-generate-runtime.test.ts`
- Modify: `tests/unit/ai-generate-page.test.ts`

**Interfaces:**
- Produces `submitAiGenerateJob(input, idempotencyKey)` wrapper around generated `createAiGenerateJob`.
- Changes `buildAiGenerateRequest(draft)` to return the generated typed request body.

- [ ] **Step 1: Write failing frontend contract tests**

Assert draft references become `referenceAssetIds`, image/video fields remain discriminated, revisions preserve `parentJobId`, and the page imports and calls `submitAiGenerateJob` rather than generic `submitJob`.

- [ ] **Step 2: Run and verify RED**

Run: `bun test tests/unit/ai-generate-runtime.test.ts tests/unit/ai-generate-page.test.ts`

Expected: FAIL because the runtime still emits a string map and the page calls the generic route.

- [ ] **Step 3: Export OpenAPI and generate SDK**

Run:

```bash
bun run api:spec
bun run api:generate
```

- [ ] **Step 4: Implement the wrapper and page migration**

Use the generated request/response types. Preserve assistant-ui attachments, mention resolution, parent lineage, polling, and error toast behavior.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `bun test tests/unit/ai-generate-runtime.test.ts tests/unit/ai-generate-page.test.ts`

Expected: all frontend contract tests pass.

### Task 6: Completion audit and repository verification

**Files:**
- Modify only files required by failures attributable to this work.

- [ ] **Step 1: Run focused feature verification**

```bash
bun test tests/unit/ai-generate-contract.test.ts \
  tests/unit/aihubmix-image.test.ts \
  tests/unit/ai-generate-api.test.ts \
  tests/unit/ai-generate-worker.test.ts \
  tests/unit/ai-generate-runtime.test.ts \
  tests/unit/ai-generate-page.test.ts \
  tests/unit/creation-capabilities.test.ts \
  tests/unit/worker-job-registry.test.ts
```

- [ ] **Step 2: Run generated-contract checks**

```bash
bun run api:spec
bun run api:generate
bun run typecheck
```

- [ ] **Step 3: Run repository baseline**

```bash
make ci
bun run build
git diff --check
```

Record any pre-existing FFmpeg environment failures separately; do not claim the full suite is green unless the command exits zero.

- [ ] **Step 4: Audit requirements against evidence**

Confirm the dedicated route exists in OpenAPI, the generated Web SDK calls it, registry selects the dedicated Worker, reference images reach multipart edits, videos reach Seedance, artifacts are owner-scoped, and no AI creation path permits Mock fallback.
