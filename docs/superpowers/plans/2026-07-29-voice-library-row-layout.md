# Voice Library Row Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make long voice asset names and metadata render as stable, readable rows without overlapping the preview action.

**Architecture:** Keep `ReusableAssetLibrary` as the owner of filtering, selection and preview state. Change only its voice-row markup so the metadata stack can shrink and truncate while the action slot stays fixed; add a source-level regression test for those layout contracts.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Bun Test, Biome.

## Global Constraints

- Reuse the shared compact asset-page shell and horizontal `voice-row` pattern.
- Use existing semantic typography utilities; do not add page-specific raw typography CSS.
- Do not change upload, deletion, selection, or audio-preview data flow.

---

### Task 1: Stabilize the voice metadata and action slots

**Files:**
- Create: `tests/unit/voice-library-layout.test.ts`
- Modify: `web/features/asset-library/asset-library.tsx`

**Interfaces:**
- Consumes: the voice branch in `ReusableAssetLibrary({ kind: "voice" })`.
- Produces: a stable `data-testid="voice-library-row"`, a `min-w-0 flex-1` metadata region, and a `shrink-0` action region.

- [ ] **Step 1: Write the failing test**

```ts
expect(source).toContain('data-testid="voice-library-row"');
expect(source).toContain('min-w-0 flex-1');
expect(source).toContain('shrink-0');
expect(source).toContain('truncate type-helper text-muted');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/voice-library-layout.test.ts`

Expected: FAIL because the voice row has no stable row test id and its action slot may shrink.

- [ ] **Step 3: Write minimal implementation**

```tsx
<article data-testid="voice-library-row" className="flex min-h-16 items-center gap-3 ...">
  <Button className="min-w-0 flex-1 ...">
    <b className="block w-full truncate ...">{asset.name}</b>
    <span className="block w-full truncate ...">{asset.description || asset.originalName}</span>
    <small className="block w-full truncate ...">...</small>
  </Button>
  <div className="shrink-0">...</div>
</article>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/voice-library-layout.test.ts`

Expected: PASS.

### Task 2: Verify the voice-row integration

**Files:**
- Modify: `web/features/asset-library/asset-library.tsx`
- Test: `tests/unit/voice-library-layout.test.ts`

**Interfaces:**
- Consumes: the stable row structure from Task 1.
- Produces: a type-safe production asset-library build.

- [ ] **Step 1: Format changed files**

Run: `bunx biome check --write web/features/asset-library/asset-library.tsx tests/unit/voice-library-layout.test.ts`

- [ ] **Step 2: Run focused regression test**

Run: `bun test tests/unit/voice-library-layout.test.ts`

Expected: PASS.

- [ ] **Step 3: Run type and build verification**

Run: `bun run typecheck && bun run build`

Expected: both commands exit successfully.
