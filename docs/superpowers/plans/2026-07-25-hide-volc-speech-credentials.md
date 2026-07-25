# Hide Volc Speech Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Hide Volc Speech from active credential administration and default Doctor checks without deleting compatibility.

**Architecture:** Add an active credential catalog that excludes `volc-speech`, while retaining the complete catalog for
storage and import/export. Use the active catalog for masked listings and active Provider IDs, and remove the Volc Speech
probe from the default Doctor provider list.

**Tech Stack:** TypeScript, Bun Test, Drizzle SQLite

## Global Constraints

- Keep Volc TOS visible and checked.
- Keep stored Volc Speech values, Provider code, Worker routing, scripts, and legacy import/export support.
- Use TDD and do not run E2E.

### Task 1: Active credential catalog

- [ ] Add failing tests asserting masked listings omit both Volc Speech fields while retaining TOS and Qwen.
- [ ] Add `managedProviderCredentialCatalog` and `managedProviderIds` derived from the complete catalog.
- [ ] Use the managed catalog in `listMasked()` and `listChecks()` only.
- [ ] Run `bun test tests/unit/provider-credential-store.test.ts`.

### Task 2: Default Doctor providers

- [ ] Add a failing test asserting the default Doctor provider IDs omit `volc-speech` and retain `tos` and `qwen-audio`.
- [ ] Export the default provider list and remove only the Volc Speech probe.
- [ ] Keep custom provider injection unchanged so internal compatibility tests still cover Volc Speech.
- [ ] Run `bun test tests/unit/credential-doctor.test.ts`.

### Task 3: Verification

- [ ] Run focused credential, Doctor, admin, and feature-gate tests.
- [ ] Run `make ci`, `bun run typecheck`, and `bun run build`.
- [ ] Run `git diff --check` and confirm no Volc Speech storage or execution implementation was deleted.
