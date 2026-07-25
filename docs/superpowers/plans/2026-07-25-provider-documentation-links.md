# Provider Documentation Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Link every active credential Provider to capability documentation.

**Architecture:** Store `docsUrl` in the backend credential catalog, expose it through the masked credential API, and
render the Provider cell as a safe external link. Regenerate OpenAPI and the generated Web SDK after changing the schema.

**Tech Stack:** TypeScript, Hono OpenAPI, React, Bun Test

### Task 1: Catalog and API contract

- [ ] Add failing tests for exact active Provider URL mappings and the `docsUrl` API field.
- [ ] Add `docsUrl` to active catalog entries and `MaskedProviderCredential`.
- [ ] Add `docsUrl: z.string().url()` to `AdminCredentialSchema`.
- [ ] Run focused catalog/API tests.

### Task 2: Provider link UI

- [ ] Add a failing source-contract test for `target="_blank"`, `rel="noopener noreferrer"`, and an external-link icon.
- [ ] Render Provider names as compact links using the API-provided `docsUrl`.
- [ ] Run the admin page test.

### Task 3: Generated artifacts and verification

- [ ] Run `bun run api:spec` and `bun run api:generate`.
- [ ] Run focused tests, `make ci`, `bun run typecheck`, and `bun run build`.
- [ ] Run `git diff --check` and review scope.
