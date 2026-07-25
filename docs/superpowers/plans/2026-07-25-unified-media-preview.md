# Unified Media Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace duplicated business image, audio, and video rendering with shared media components that open an auto-playing full-screen preview.

**Architecture:** Add a `MediaPreview` facade with dedicated image, audio, and video renderers plus one shared lightbox. Keep `AuthenticatedMedia` as a compatibility export, and route local Blob previews through the same facade.

**Tech Stack:** React 19, TypeScript strict, shadcn-style UI primitives, Bun Test, Tailwind CSS

## Global Constraints

- Cover business media across uploads, assets, task results, creation, remix, and mashup surfaces.
- Exclude logos, decorative portraits/avatars, and video-editor canvas media.
- Do not edit generated SDK, OpenAPI, or migration artifacts.
- Do not add dependencies or explanatory title copy.
- Do not run E2E tests.

---

### Task 1: Shared media renderers and lightbox

**Files:**
- Create: `web/components/domain/media-preview.tsx`
- Modify: `web/components/domain/authenticated-media.tsx`
- Test: `tests/unit/media-preview-component.test.ts`

**Interfaces:**
- Produces: `MediaPreviewProps`, `MediaPreview`, `ImagePreview`, `VideoPreview`, `AudioPreview`
- `MediaPreviewProps` accepts `url`, `mimeType`, `alt`, `autoPlay`, `controls`, `loadingText`, `errorText`,
  `onMetadata`, `authenticated`, and `previewable`.

- [ ] **Step 1: Write a failing source-contract test**

Verify dedicated renderers exist, MIME dispatch selects them, a `role="dialog"` lightbox is rendered on demand,
Escape/backdrop/close-button semantics exist, and full-screen audio/video receive `autoPlay`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun test tests/unit/media-preview-component.test.ts`

Expected: FAIL because `web/components/domain/media-preview.tsx` does not exist.

- [ ] **Step 3: Implement the shared components**

Create the media facade, Blob URL loader, independent native renderers, interaction guard, and full-screen overlay.
Make `AuthenticatedMedia` delegate to `MediaPreview` with `authenticated`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `bun test tests/unit/media-preview-component.test.ts`

Expected: PASS.

### Task 2: Local upload integration

**Files:**
- Modify: `web/components/domain/file-upload.tsx`
- Test: `tests/unit/file-upload.test.ts`

**Interfaces:**
- Consumes: `MediaPreview` with `authenticated={false}` for local object URLs.

- [ ] **Step 1: Add a failing test for shared local preview use**

Assert that `LocalMediaPreview` is removed and local image/audio/video entries render through `MediaPreview`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun test tests/unit/file-upload.test.ts`

Expected: FAIL while `LocalMediaPreview` remains.

- [ ] **Step 3: Replace the duplicated local renderer**

Pass the existing object URL, file MIME type, and file name to `MediaPreview` with authentication disabled.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `bun test tests/unit/file-upload.test.ts`

Expected: PASS.

### Task 3: Business-surface coverage and regression verification

**Files:**
- Modify only if audit finds direct business media tags outside exclusions.
- Test: `tests/unit/media-preview-coverage.test.ts`

**Interfaces:**
- Consumes: `MediaPreview` directly or through the `AuthenticatedMedia` compatibility export.

- [ ] **Step 1: Add a failing coverage test**

Audit `web/features` and `web/components/domain` and assert no direct business image/audio/video renderers remain,
except explicitly listed decorative media and video-editor canvas elements.

- [ ] **Step 2: Run the coverage test and verify RED**

Run: `bun test tests/unit/media-preview-coverage.test.ts`

Expected: FAIL on currently duplicated business media renderers.

- [ ] **Step 3: Replace remaining in-scope renderers**

Use the shared facade without changing page layout, metadata handling, controls, or business behavior.

- [ ] **Step 4: Run the coverage test and verify GREEN**

Run: `bun test tests/unit/media-preview-coverage.test.ts`

Expected: PASS.

- [ ] **Step 5: Run repository verification**

Run: `make ci && bun run typecheck && bun run build`

Expected: all commands exit 0.

- [ ] **Step 6: Audit the final diff**

Run: `git status --short && git diff --check && git diff --stat`

Expected: only plan, shared media, integration, test, and narrowly required style files changed.

### Task 4: ReactPlayer video interaction

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `web/components/domain/media-preview.tsx`
- Modify: `web/features/asset-library/asset-library.tsx`
- Test: `tests/unit/media-preview-component.test.tsx`

**Interfaces:**
- `VideoPreview` uses `react-player@3.4.0` and reports duration through the existing `onMetadata` contract.
- Thumbnail videos preserve current time across hover pause and full-screen transitions.

- [ ] **Step 1: Add failing interaction tests**

Verify the rendered player starts on mouse enter, pauses on mouse leave without resetting time, displays
`current / duration` seconds, and opens the full-screen dialog only on double click.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun test tests/unit/media-preview-component.test.tsx`

Expected: FAIL because the current video preview uses a native video element and a single-click overlay.

- [ ] **Step 3: Install and implement ReactPlayer**

Install exact version `react-player@3.4.0`. Replace the video renderer with a controlled ReactPlayer, shared time state,
hover handlers, time badge, double-click full-screen transition, and full-screen controls.

- [ ] **Step 4: Remove the asset-library legacy play overlay**

Delete `LazyVideoPreview` playback state and its separate “播放” button. Render the shared media component directly.

- [ ] **Step 5: Verify the focused behavior**

Run: `bun test tests/unit/media-preview-component.test.tsx tests/unit/file-upload.test.tsx`

Expected: PASS.

- [ ] **Step 6: Run repository verification**

Run: `bun run typecheck && bun run build`

Expected: both commands exit 0.

### Task 5: Interactive audio card

**Files:**
- Modify: `web/components/domain/media-preview.tsx`
- Modify: `web/features/asset-library/asset-library.css`
- Test: `tests/unit/media-preview-component.test.tsx`

**Interfaces:**
- `InteractiveAudioPreview` shares current time and duration between its card and full-screen player.
- Authenticated Blob audio stays on `HTMLAudioElement` because ReactPlayer cannot infer audio from an extensionless URL.

- [ ] **Step 1: Add failing interaction tests**

Verify audio hover play/pause state, `current / duration` seconds, and double-click full-screen behavior.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bun test tests/unit/media-preview-component.test.tsx`

Expected: FAIL because audio still exposes native controls.

- [ ] **Step 3: Implement the interactive audio card**

Add the card surface, hidden controlled audio element, hover state, time badge, double-click full-screen transition,
and progress restoration after closing.

- [ ] **Step 4: Verify and build**

Run: `bun test tests/unit/media-preview-component.test.tsx && bun run typecheck && bun run build`

Expected: all commands exit 0.
