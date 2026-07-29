# Local Image Upload Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render selected local image files as immediate thumbnails in the shared upload component before submission.

**Architecture:** `FileUpload` owns a per-file data URL map keyed by stable file metadata. A change-aware effect reads image files through `FileReader`, then the existing pending-file card chooses the image preview when available and retains the file icon fallback for every other type.

**Tech Stack:** React 19, TypeScript, Bun Test, Tailwind CSS.

## Global Constraints

- Do not use `URL.createObjectURL` or `URL.revokeObjectURL`.
- Preserve existing upload selection, retry, clear and progress behavior.
- Reuse the current shared file-card layout and semantic typography roles.

---

### Task 1: Add regression coverage for local image thumbnails

**Files:**
- Modify: `tests/unit/file-upload.test.tsx`
- Modify: `web/components/domain/file-upload.tsx`

**Interfaces:**
- Consumes: `FileUploadProps.files: File[]`.
- Produces: a pending image card with a local `img` source after image selection.

- [ ] **Step 1: Write a failing test**

```tsx
const image = new File(["image"], "product.png", { type: "image/png" });
root.render(<FileUpload files={[image]} onFilesChange={() => undefined} />);
expect(await waitForImage()).toBeTruthy();
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `bun test tests/unit/file-upload.test.tsx`

Expected: FAIL because pending files currently render `FileText` only.

- [ ] **Step 3: Implement the local image preview map**

```tsx
useEffect(() => {
  // Read image File values with FileReader.readAsDataURL and retain only current file keys.
}, [files]);
```

- [ ] **Step 4: Render the preview or file icon fallback**

```tsx
{previewUrl ? <img src={previewUrl} alt={file.name} /> : <FileText aria-hidden="true" />}
```

- [ ] **Step 5: Run the focused test and confirm it passes**

Run: `bun test tests/unit/file-upload.test.tsx`

Expected: PASS.

### Task 2: Verify shared-upload integration

**Files:**
- Modify: `web/components/domain/file-upload.tsx`
- Test: `tests/unit/file-upload.test.tsx`

**Interfaces:**
- Consumes: local pending image preview behavior from Task 1.
- Produces: type-safe shared upload rendering.

- [ ] **Step 1: Format changed files**

Run: `bunx biome check --write web/components/domain/file-upload.tsx tests/unit/file-upload.test.tsx`

- [ ] **Step 2: Verify behavior and build**

Run: `bun test tests/unit/file-upload.test.tsx && bun run typecheck && bun run build`

Expected: all commands exit successfully.
