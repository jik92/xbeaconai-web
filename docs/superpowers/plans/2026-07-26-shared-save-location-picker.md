# Shared Save Location Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one reusable save-location picker that lets every task creation, import, and export flow create, select, and default an asset folder.

**Architecture:** `SaveLocationPicker` is a controlled React component backed by the shared `["asset-folders"]` React Query cache. It owns folder loading, hierarchical display, default initialization, inline creation, and default-setting feedback; consumers only store the selected ID and submit their existing payload.

**Tech Stack:** React 19, TypeScript strict, TanStack Query, Bun Test, happy-dom, Tailwind CSS.

## Global Constraints

- Work directly on `main`; do not create a branch.
- Reuse `createAssetFolder`, `setDefaultAssetFolder`, and the existing `["asset-folders"]` query key.
- Do not change API payload fields or generated API files.
- New folders are root folders, become selected, and are requested as the default.
- Do not run Playwright E2E.

---

### Task 1: Shared save-location picker

**Files:**
- Create: `web/components/domain/save-location-picker.tsx`
- Test: `tests/unit/save-location-picker.test.tsx`

**Interfaces:**
- Consumes: `fetchAssetFolders(): Promise<AssetFolder[]>`, `createAssetFolder(name: string): Promise<AssetFolder>`, `setDefaultAssetFolder(folderId: string): Promise<AssetFolder>`.
- Produces: `SaveLocationPicker({ value, onChange, required?, invalid?, disabled?, className? })`.

- [ ] **Step 1: Write failing component tests**

Cover these observable behaviors with happy-dom and a real QueryClient: a blank value selects the default folder after loading; nested folders render with indentation and default text; “新建文件夹” reveals an inline input; submitting a trimmed name creates a root folder, selects it, requests it as default, and refreshes the list; API failure remains visible.

- [ ] **Step 2: Run the test and verify RED**

Run: `bun test tests/unit/save-location-picker.test.tsx`

Expected: FAIL because `SaveLocationPicker` does not exist.

- [ ] **Step 3: Implement the minimal component**

Use `useQuery({ queryKey: ["asset-folders"], queryFn: fetchAssetFolders })` and `useQueryClient()`. Flatten the parent/child tree for `<NativeSelect>`, initialize invalid values to the default or first folder in an effect, and implement compact inline create controls with shared `Input` and `Button`. On create, call `createAssetFolder(trimmedName)`, immediately select the returned ID, then call `setDefaultAssetFolder(id)` and invalidate/refetch `["asset-folders"]`. Keep any error in a `role="alert"` element.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `bun test tests/unit/save-location-picker.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit the component and test as `feat: add shared save location picker`.

### Task 2: Replace duplicated task selectors

**Files:**
- Modify: `web/components/domain/module-page.tsx`
- Modify: `web/features/video-mashup/video-mashup-page.tsx`
- Modify: `web/features/video-extract/video-extract-page.tsx`
- Modify: `web/features/video-editor/video-editor-page.tsx`
- Test: `tests/unit/save-location-picker-consumers.test.tsx`

**Interfaces:**
- Consumes: `SaveLocationPicker` from Task 1.
- Produces: all four flows submit their existing selected folder field while sharing creation/default behavior.

- [ ] **Step 1: Write failing consumer tests**

Render the exported form-level consumers where practical, and assert each save field exposes the common accessible name and new-folder action. For large page boundaries, extract only a focused exported form section if needed; do not assert source text.

- [ ] **Step 2: Run the test and verify RED**

Run: `bun test tests/unit/save-location-picker-consumers.test.tsx`

Expected: FAIL because the pages still use their own native selects.

- [ ] **Step 3: Replace duplicated queries and selectors**

In `ModulePage`, remove the local folder query, ordering, default effect, and `onSetDefaultFolder` plumbing, then render `SaveLocationPicker` for `saveLocation`. In video mashup, video extract, and video editor, remove their folder queries/default effects and render the same controlled component with `outputFolderId`, `folderId`, and `exportFolderId`. Keep current required validation and payload names.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
bun test tests/unit/save-location-picker.test.tsx tests/unit/save-location-picker-consumers.test.tsx
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Commit consumer integration as `refactor: reuse save location picker`.

### Task 3: Delivery verification and design synchronization

**Files:**
- Modify: `DESIGN.md`

**Interfaces:**
- Consumes: completed component and consumer integrations.
- Produces: documented reusable interaction and verified production build.

- [ ] **Step 1: Document the component**

Add a concise `save-location-picker` entry under Forms & Tags describing its compact select, inline root-folder creation, automatic select/default behavior, hierarchy, and error handling.

- [ ] **Step 2: Run formatting and focused verification**

Run:

```bash
bunx biome check web/components/domain/save-location-picker.tsx web/components/domain/module-page.tsx web/features/video-mashup/video-mashup-page.tsx web/features/video-extract/video-extract-page.tsx web/features/video-editor/video-editor-page.tsx tests/unit/save-location-picker.test.tsx tests/unit/save-location-picker-consumers.test.tsx
bun test tests/unit/save-location-picker.test.tsx tests/unit/save-location-picker-consumers.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run full delivery baseline**

Run:

```bash
make ci
bun run typecheck
bun run build
```

Expected: typecheck and build pass. If `make ci` reaches the known local FFmpeg failures, record those exact failures and confirm no new failures.

- [ ] **Step 4: Audit and push**

Inspect `git diff`, ensure no generated files or unrelated changes are present, commit remaining documentation/formatting changes, then push `main` to `origin/main`.

