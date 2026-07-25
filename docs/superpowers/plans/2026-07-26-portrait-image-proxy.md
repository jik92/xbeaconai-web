# Portrait Image Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore every portrait preview by serving controlled catalog images inline through the local API.

**Architecture:** Keep catalog `source_url` unchanged for model calls and derive `display_url` for browser rendering. A public read-only Hono route resolves only known catalog IDs, validates the upstream image response, and rewrites attachment responses as cacheable inline images.

**Tech Stack:** Bun, React 19, Hono OpenAPI, TanStack Query, Bun Test

## Global Constraints

- Do not use browser automation for verification.
- Do not proxy arbitrary user-provided URLs.
- Preserve the existing portrait page layout and metadata.
- Use TDD before production changes.

---

### Task 1: Browser-safe portrait URL

**Files:**
- Modify: `tests/unit/portrait-data.test.ts`
- Modify: `web/features/portrait-library/portrait-data.ts`
- Modify: portrait preview consumers under `web/features/`

**Interfaces:**
- Produces: `Portrait.display_url: string`

- [ ] Add a failing test expecting portrait ID 1 to map to `/api/portraits/1/content`.
- [ ] Run the test and verify `display_url` is missing.
- [ ] Derive `display_url` in `parsePortrait` and switch visual consumers from `source_url`.
- [ ] Rerun the focused data and consumer contract tests.

### Task 2: Controlled inline image route

**Files:**
- Modify: `server/app.ts`
- Modify: `tests/integration/douyin-api-isolated.test.ts`
- Regenerate: `openapi/openapi.json`
- Regenerate: `web/api/generated/`

**Interfaces:**
- Produces: `GET /api/portraits/{portraitId}/content`

- [ ] Add failing integration cases for a known portrait, unknown ID and invalid upstream MIME.
- [ ] Run the isolated API test and verify the route returns 404 before implementation.
- [ ] Add the catalog-only fetch route with inline content disposition, MIME validation and cache headers.
- [ ] Regenerate OpenAPI/SDK and rerun the isolated API test.

### Task 3: Verification

**Files:**
- Inspect all changed files.

**Interfaces:**
- Produces: verified portrait image loading fix

- [ ] Run portrait data and API integration tests.
- [ ] Run `bun run typecheck`, `bun run build`, and `git diff --check`.
- [ ] Inspect every portrait visual consumer for remaining raw `source_url` usage.
