# Optional Library Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make “不保存素材库” the initial per-tool default while preserving task results and remembering an explicitly selected folder.

**Architecture:** Represent no-save as the absence of a module default row and an empty `outputFolderId`. The shared picker owns switching and persistence, the API validates only non-empty folders, and workers store non-library results as downloadable job artifacts.

**Tech Stack:** Bun, React 19, TanStack Query, Hono OpenAPI, Drizzle SQLite, Bun Test

## Global Constraints

- Work directly on `main`; do not create a branch.
- Do not hand-edit generated OpenAPI SDK files.
- Use TDD for each behavior change.
- Default AI tool task behavior is “不保存素材库”.
- Selecting a folder persists only that module's default; selecting no-save clears it.

---

### Task 1: Nullable module default

**Files:**
- Modify: `tests/unit/asset-folders.test.ts`
- Modify: `server/accounts/account-store.ts`
- Modify: `server/app.ts`
- Modify: `web/api/api-client.ts`
- Regenerate: `openapi/openapi.json`
- Regenerate: `web/api/generated/`

**Interfaces:**
- Produces: `getModuleOutputFolder(userId, moduleId): AssetFolder | undefined`
- Produces: `setModuleOutputFolder(userId, moduleId, folderId?: string): AssetFolder | undefined`

- [ ] Write Store/API tests proving a new module resolves to no folder and a null PUT clears an existing default.
- [ ] Run the focused tests and verify the old global-folder fallback fails them.
- [ ] Remove the fallback, delete the row for an empty folder ID, and make GET/PUT schemas nullable.
- [ ] Regenerate OpenAPI and the SDK, then rerun the focused tests.
- [ ] Commit the nullable default contract.

### Task 2: Shared picker no-save option

**Files:**
- Modify: `tests/unit/save-location-picker.test.tsx`
- Modify: `web/components/domain/save-location-picker.tsx`
- Modify: `DESIGN.md`

**Interfaces:**
- Consumes: nullable `fetchToolOutputFolder` and `setToolOutputFolder`
- Produces: `onChange("")` for no-save

- [ ] Write component tests proving the initial value remains empty and selecting no-save clears the module default.
- [ ] Run the test and verify it fails because the picker auto-selects a folder or disables the empty option.
- [ ] Add the selectable “不保存素材库” option and persist empty selection.
- [ ] Rerun the component tests and update the shared component design entry.
- [ ] Commit the picker behavior.

### Task 3: Optional task submission

**Files:**
- Modify: `tests/unit/ai-tool-save-location.test.tsx`
- Modify: `web/components/domain/module-page.tsx`
- Modify: `web/features/video-mashup/video-mashup-page.tsx`
- Modify: `web/features/voice-clone/qwen-voice-clone-modal.tsx`
- Modify: `server/app.ts`
- Modify: `shared/video-mashup/config.ts`

**Interfaces:**
- Consumes: `outputFolderId: string`, where `""` means no-save
- Produces: accepted AI-tool jobs without `outputFolderId`

- [ ] Write tests proving controls are optional and task submission accepts empty output folders.
- [ ] Run the tests and verify required UI/API validation causes failure.
- [ ] Remove required validation and validate folder ownership only when the ID is non-empty.
- [ ] Rerun focused UI/API tests.
- [ ] Commit optional submission behavior.

### Task 4: Non-library artifacts

**Files:**
- Modify: worker tests covering AI tool outputs
- Modify: AI tool handlers under `worker/jobs/`

**Interfaces:**
- Consumes: optional `job.values.outputFolderId`
- Produces: `/api/assets/{id}/content` for saved results or `/api/artifacts/{id}` for non-library results

- [ ] Write focused handler tests proving empty output folders create task artifacts and do not create media assets.
- [ ] Run tests and verify current handlers reject empty folders.
- [ ] Add shared result-file registration logic and branch handlers by the presence of an owned folder.
- [ ] Rerun handler tests and ensure saved-folder behavior remains green.
- [ ] Commit worker artifact support.

### Task 5: Verification and publish

**Files:**
- Inspect all changed files.

**Interfaces:**
- Produces: verified and pushed `main`

- [ ] Run focused tests for Store, API, picker, task forms, and workers.
- [ ] Run `bun run typecheck`, `bun run build`, and `git diff --check`.
- [ ] Run `make ci`; distinguish repository baseline failures from regressions.
- [ ] Commit remaining changes with a terse scoped message.
- [ ] Push `main` using `git push origin main` and confirm local/remote commit equality.
