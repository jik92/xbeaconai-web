# assistant-ui AI Generate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/tools/ai-generate` browser Mock with an assistant-ui conversation backed by the real Job API and Worker, including image/video generation, iterative revisions, and `@` asset references.

**Architecture:** Keep SQLite Jobs and TanStack Query as authoritative state and expose them to assistant-ui through `useExternalStoreRuntime`. Extend the existing generic Job contract with validated parent/revision metadata, then route image and video work through existing real providers without Mock fallback.

**Tech Stack:** Bun, React 19, `@assistant-ui/react`, TanStack Query, Hono OpenAPI, BullMQ, Drizzle, Tailwind CSS, Bun Test.

## Global Constraints

- Do not edit `web/api/generated/`, `openapi/openapi.json`, or `drizzle/meta/` manually.
- Use TypeScript strict mode and do not introduce `any`.
- Use existing API SDK, UI components, schemas, upload flows, and Worker contracts.
- Do not add a page-specific CSS file; delete `web/features/ai-generate/ai-generate.css`.
- Do not silently fall back to Mock; submit AI Generate jobs with `allowMockFallback: false`.
- Preserve owner isolation for Jobs, assets, parent Jobs, and generated artifacts.
- Do not run E2E unless the user explicitly asks.

---

### Task 1: Define and validate AI Generate revision inputs

**Files:**
- Create: `shared/jobs/ai-generate-contract.ts`
- Modify: `server/app.ts`
- Test: `tests/unit/ai-generate-contract.test.ts`
- Test: `tests/unit/ai-generate-api.test.ts`

**Interfaces:**
- Produces: `parseAiGenerateValues(values: Record<string, string>): AiGenerateInput`
- Produces: `AiGenerateInput` with `creationKind`, `prompt`, model parameters, `references`, `parentJobId`, and `revisionMode`.
- Consumes: existing Job Store owner lookup and `createJob` route.

- [ ] **Step 1: Write failing contract tests**

Cover valid image/video input, malformed JSON references, unknown mentions, invalid `parentJobId`, and `revisionMode` without a parent.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `bun test tests/unit/ai-generate-contract.test.ts tests/unit/ai-generate-api.test.ts`

Expected: FAIL because `shared/jobs/ai-generate-contract.ts` and route validation do not exist.

- [ ] **Step 3: Implement the shared parser and owner-safe API validation**

Use a discriminated union for image/video settings. Parse `references` into typed asset descriptors. In `server/app.ts`, load `parentJobId` from the authenticated user's Job Store and return a structured 422 error when it is absent, invalid, or owned by another user.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `bun test tests/unit/ai-generate-contract.test.ts tests/unit/ai-generate-api.test.ts`

Expected: all focused tests pass.

### Task 2: Route real image and video revisions through Worker

**Files:**
- Create: `worker/jobs/job-ai-generate.ts`
- Modify: `worker/jobs/registry.ts`
- Modify: `worker/jobs/job-seedance-video.ts`
- Modify: `worker/jobs/definitions/ai-generate.ts`
- Test: `tests/unit/ai-generate-worker.test.ts`
- Test: `tests/unit/worker-job-registry.test.ts`

**Interfaces:**
- Consumes: `parseAiGenerateValues`, parent Job result artifacts, current Provider clients.
- Produces: `aiGenerateJobHandler: WorkerJobHandler`.
- Produces: completed Job results whose artifacts contain real image/video MIME types and execution source.

- [ ] **Step 1: Write failing Worker tests**

Assert that `ai-generate` resolves to the dedicated handler, image requests use the configured image capability, video requests reuse Seedance submission/poll/cancel behavior, parent artifacts become revision references, and Provider failures do not become Mock results.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `bun test tests/unit/ai-generate-worker.test.ts tests/unit/worker-job-registry.test.ts`

Expected: FAIL because `ai-generate` still resolves to `generic-creation`.

- [ ] **Step 3: Implement the dedicated handler**

Delegate video execution to the existing Seedance flow instead of copying it. Use the existing image Provider path for image requests. Resolve only owner-safe stored artifacts, emit definition stages, persist progress, and return structured source metadata.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `bun test tests/unit/ai-generate-worker.test.ts tests/unit/worker-job-registry.test.ts`

Expected: all focused tests pass.

### Task 3: Add assistant-ui dependency and message mapping

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Create: `web/features/ai-generate/ai-generate-runtime.ts`
- Test: `tests/unit/ai-generate-runtime.test.ts`

**Interfaces:**
- Consumes: generated `Job` types and Task 1 `AiGenerateInput`.
- Produces: `jobsToThreadMessages(jobs: Job[]): ThreadMessage[]`
- Produces: `buildRevisionValues(input: RevisionDraft): Record<string, string>`
- Produces: `parseAssetMentions(text: string, references: AiGenerateReference[]): MentionResolution`.

- [ ] **Step 1: Install the official runtime package**

Run: `bun add @assistant-ui/react`

Expected: `package.json` and `bun.lock` record the current compatible release.

- [ ] **Step 2: Write failing mapping and mention tests**

Assert stable message IDs, queued/running/completed/failed status mapping, authenticated artifact parts, exact `@图片1` resolution, unresolved mention errors, and parent/revision request values.

- [ ] **Step 3: Run the focused tests and verify RED**

Run: `bun test tests/unit/ai-generate-runtime.test.ts`

Expected: FAIL because the runtime helpers do not exist.

- [ ] **Step 4: Implement pure mapping helpers**

Keep React hooks out of the helper module. Preserve chronological order, emit one user/assistant pair per Job, and map image/video artifacts without inventing successful output.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run: `bun test tests/unit/ai-generate-runtime.test.ts`

Expected: all focused tests pass.

### Task 4: Build the assistant-ui Thread and Composer

**Files:**
- Create: `web/features/ai-generate/ai-generate-thread.tsx`
- Create: `web/features/ai-generate/ai-generate-composer.tsx`
- Create: `web/features/ai-generate/ai-generate-runtime-provider.tsx`
- Rewrite: `web/features/ai-generate/ai-generate-page.tsx`
- Test: `tests/unit/ai-generate-page.test.tsx`

**Interfaces:**
- Consumes: `jobsToThreadMessages`, `buildRevisionValues`, `parseAssetMentions`, `fetchCreationCapabilities`, `fetchJobs`, `submitJob`, `downloadAuthenticated`.
- Produces: `AiGenerateRuntimeProvider`, `AiGenerateThread`, `AiGenerateComposer`, and the route-level `AiGeneratePage`.

- [ ] **Step 1: Write failing component tests**

Render the authenticated route and assert assistant-ui Thread/Message/Composer primitives are present, capability-backed image/video selection works, choosing assets inserts resolvable mention labels, send calls the real Job client with `allowMockFallback: false`, and reload/variant actions include `parentJobId`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun test tests/unit/ai-generate-page.test.tsx`

Expected: FAIL because the current page imports the Mock Store and has no assistant-ui runtime.

- [ ] **Step 3: Implement ExternalStoreRuntime integration**

Use `AssistantRuntimeProvider` with `useExternalStoreRuntime`. Map Query Jobs to messages, implement `onNew`, `onEdit`, and `onReload`, and keep the composer send gate active until capabilities and upload references are valid.

- [ ] **Step 4: Compose official primitives and existing project UI**

Build the viewport with `ThreadPrimitive`, messages with `MessagePrimitive`, controls with `ActionBarPrimitive`, input/attachments with `ComposerPrimitive` and `AttachmentPrimitive`, and settings with existing `Button`, `Popover`, `Dialog`, and `NativeSelect`. Keep all styling in approved Tailwind classes.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `bun test tests/unit/ai-generate-page.test.tsx`

Expected: all focused tests pass.

### Task 5: Remove legacy Mock/CSS coupling and regenerate the API SDK

**Files:**
- Delete: `web/features/ai-generate/ai-generate-mock.ts`
- Delete: `web/features/ai-generate/ai-generate.css`
- Modify: `web/components/domain/prompt-workbench.tsx`
- Generate: `openapi/openapi.json`
- Generate: `web/api/generated/*`
- Test: `tests/unit/ai-generate-page.test.tsx`

**Interfaces:**
- Consumes: completed assistant-ui page and updated Hono OpenAPI schema.
- Produces: no runtime import of legacy AI Generate CSS or Mock Store; generated SDK matches Server contract.

- [ ] **Step 1: Add a failing source guard test**

Assert no production file imports `ai-generate.css` or `ai-generate-mock`, and the AI Generate page imports `@assistant-ui/react`.

- [ ] **Step 2: Run the source guard and verify RED**

Run: `bun test tests/unit/ai-generate-page.test.tsx`

Expected: FAIL while legacy imports remain.

- [ ] **Step 3: Remove legacy files and imports**

Delete the Mock Store and CSS. Move any still-used generic PromptWorkbench styling to existing Tailwind classes or stop using the component. Do not create replacement business CSS.

- [ ] **Step 4: Regenerate the API contract**

Run: `bun run api:spec && bun run api:generate`

Expected: generated OpenAPI and SDK include the validated AI Generate request fields or continue to expose the generic record without handwritten generated edits.

- [ ] **Step 5: Run focused tests and type checking**

Run: `bun test tests/unit/ai-generate-page.test.tsx tests/unit/ai-generate-runtime.test.ts && bun run typecheck`

Expected: tests pass and TypeScript exits 0.

### Task 6: Full verification and requirement audit

**Files:**
- Review: all files changed by Tasks 1–5.

**Interfaces:**
- Consumes: the complete implementation.
- Produces: fresh evidence for every explicit requirement.

- [ ] **Step 1: Run the repository delivery baseline**

Run: `make ci`

Expected: Biome and all unit tests exit 0.

- [ ] **Step 2: Run strict compilation and production build**

Run: `bun run typecheck && bun run build`

Expected: both commands exit 0.

- [ ] **Step 3: Audit source requirements**

Run: `rg -n "ai-generate\\.css|ai-generate-mock|AiGenerateMockStore" web tests package.json`

Expected: no production matches.

Run: `rg -n "@assistant-ui/react|ThreadPrimitive|ComposerPrimitive|AttachmentPrimitive|ActionBarPrimitive" web/features/ai-generate package.json`

Expected: dependency and official primitives are present.

- [ ] **Step 4: Inspect the final diff**

Run: `git status --short && git diff --stat && git diff --check`

Expected: only scoped source, generated contract, tests, dependency lock, and plan files changed; pre-existing `web/app/config.ts` remains untouched.

