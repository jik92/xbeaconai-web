# AI Creation Real-Only Video Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ensure every AI 创作 Seedance model is real-only and can never switch to a local Mock execution path.

**Architecture:** The capability API always publishes real Seedance execution and gates availability by verified Ark model IDs. The Seedance job removes its environment-controlled FFmpeg generation branch; tests use injected executors instead of production Mock behavior.

**Tech Stack:** Bun, TypeScript strict, Hono, Ark Seedance Provider, Bun Test.

## Global Constraints

- No AI 创作 image or video capability may publish `executionMode: "mock"`.
- Never hide a Mock implementation behind a real label.
- Provider failure must remain explicit; no local or alternate-model fallback.
- Do not run E2E.

---

### Task 1: Real-only capability publication

**Files:**
- Modify: `server/creation/capabilities.ts`
- Modify: `server/app.ts`
- Test: `tests/unit/creation-capabilities.test.ts`
- Test: `tests/integration/ai-generate-api-isolated.test.ts`

**Interfaces:**
- Consumes: `videoModelEnabled(id)`.
- Produces: `creationCapabilities(videoModelEnabled, imageEnabled)` with real-only Seedance models.

- [x] Write a failing test proving every image and video capability is real even when the legacy Mock environment variable is set.
- [x] Run `bun test tests/unit/creation-capabilities.test.ts tests/unit/ai-generate-api.test.ts` and verify the old Mock assertion fails.
- [x] Remove `videoExecutionMode` from `creationCapabilities`, publish Seedance as `real`, and remove environment-derived mode arguments from all callers.
- [x] Re-run the tests and verify they pass.

### Task 2: Remove runtime Seedance Mock generation

**Files:**
- Modify: `worker/jobs/job-seedance-video.ts`
- Modify: `tests/unit/seedance-video-mock.test.ts`
- Test: `tests/unit/ai-generate-worker.test.ts`

**Interfaces:**
- Consumes: Ark Seedance client and existing injected AI creation test executor.
- Produces: real-only `SeedanceVideoJob.execute`.

- [x] Replace the environment-controlled FFmpeg Mock test with a failing source-path or behavior test proving `SeedanceVideoJob` cannot return a local Mock response.
- [x] Run `bun test tests/unit/seedance-video-mock.test.ts tests/unit/ai-generate-worker.test.ts` and verify failure against the current branch.
- [x] Delete the `env.mockGenerateVideoApi` execution branch and its production-only Mock imports from `job-seedance-video.ts`.
- [x] Keep request normalization and downloaded-video validation tests, then re-run both suites.

### Task 3: Complete combined image/video verification

**Files:**
- Modify: `docs/superpowers/plans/2026-07-26-ai-creation-real-video-only.md`
- Modify: `docs/superpowers/plans/2026-07-26-ai-creation-real-image-models.md`

**Interfaces:**
- Consumes: all completed image and video model work.
- Produces: checked implementation records and pushed branch.

- [x] Run focused AI creation suites, `bun run typecheck`, and `bun run build`.
- [x] Run `make ci`; record only unchanged unrelated environment failures if present.
- [x] Run `rg -n 'executionMode: "mock"|mockGenerateVideoApi|seedream-5-pro' server/creation worker/jobs/job-ai-generate.ts worker/jobs/job-seedance-video.ts`.
- [x] Run `git diff --check` and inspect `git status --short`, preserving `.DS_Store`.
- [x] Check completed plan boxes, commit all intended changes, and push `agent/assistant-ui-ai-generate`.
