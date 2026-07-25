# Sidebar Asset Counts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show live counts for materials, portraits, products, and voices in the asset sidebar navigation.

**Architecture:** AppShell reuses the four existing TanStack Query caches and derives a runtime count map keyed by asset feature ID. Static menu configuration no longer owns badge values; rendering reads the derived count and preserves navigation when a query fails.

**Tech Stack:** React 19, TanStack Query, TypeScript strict, Bun Test.

## Global Constraints

- Work directly on `main`; do not create a branch.
- Reuse existing query keys and API client functions.
- Show `0`; hide only unavailable query results.
- Do not add new CSS or explanatory copy.
- Do not run E2E.

---

### Task 1: Runtime Asset Count Mapping

**Files:**
- Modify: `web/components/domain/app-shell.tsx`
- Create: `tests/unit/sidebar-asset-counts.test.tsx`
- Modify: `DESIGN.md`

**Interfaces:**
- Produces: `assetSidebarCounts(input): Partial<Record<AssetFeatureId, string>>`
- Consumes: `fetchLibraryAssets`, `fetchProducts`, `fetchPortraits`

- [ ] **Step 1: Write the failing test**

Test that four successful arrays yield string counts, empty arrays yield `"0"`, and undefined failed/loading values omit only the affected badge.

- [ ] **Step 2: Verify RED**

Run: `bun test tests/unit/sidebar-asset-counts.test.tsx`
Expected: FAIL because runtime count mapping does not exist.

- [ ] **Step 3: Implement queries and rendering**

Add four authenticated `useQuery` calls using the existing cache keys, derive counts, remove static `badge`, and render `assetCounts[item.id.slice(6)]` for asset items while preserving the existing `HOT` module badge.

- [ ] **Step 4: Verify GREEN**

Run: `bun test tests/unit/sidebar-asset-counts.test.tsx tests/unit/sidebar-menu-preferences.test.ts`
Expected: PASS.

- [ ] **Step 5: Update design and verify**

Document that asset navigation badges are real cached counts. Run:

```bash
bun run format:check
bun run typecheck
bun run build
```

- [ ] **Step 6: Commit and push**

```bash
git add DESIGN.md web/components/domain/app-shell.tsx tests/unit/sidebar-asset-counts.test.tsx
git commit -m "feat: show live asset counts in sidebar"
git push origin main
```
