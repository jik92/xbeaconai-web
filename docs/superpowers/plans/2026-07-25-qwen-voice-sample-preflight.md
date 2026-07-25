# Qwen Voice Sample Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject invalid Qwen voice samples before queueing a task and show the precise validation result in the creation modal.

**Architecture:** A focused server preflight service owns audio retrieval and ffprobe validation. Both a protected preflight API and the Qwen create-job branch call this service, while the modal calls the API immediately after selection.

**Tech Stack:** Bun, TypeScript, React 19, Hono OpenAPI, ffprobe, TOS, Bun Test.

## Global Constraints

- Validate ownership, audio MIME type, 10MB maximum size, decodable audio stream, and 5–60 second duration.
- Do not expose filesystem paths, signed URLs, or credentials in errors.
- Do not change the Volc voice workflow.
- Do not run E2E.

---

### Task 1: Reusable preflight service

**Files:**
- Create: `server/voice/qwen-voice-sample-preflight.ts`
- Create: `tests/unit/qwen-voice-sample-preflight.test.ts`

**Interfaces:**
- Produces: `preflightQwenVoiceSample(ownerUserId, assetId, accounts)` returning duration, format, channels, and sample rate.
- Consumes: owned asset lookup, local upload storage, TOS download, and `probeMedia`.

- [ ] Write a failing test that asserts a 2.56-second sample produces the message `当前录音 2.56 秒，至少需要 5 秒`.
- [ ] Run `bun test tests/unit/qwen-voice-sample-preflight.test.ts` and verify failure.
- [ ] Implement retrieval, ffprobe validation, safe result mapping, and temporary-file cleanup.
- [ ] Run the test and verify it passes.

### Task 2: Protected preflight API and queue gate

**Files:**
- Modify: `server/app.ts`
- Create: `tests/unit/qwen-voice-preflight-api.test.ts`

**Interfaces:**
- Consumes: `preflightQwenVoiceSample`.
- Produces: `POST /api/voice-clone/qwen/sample-preflight` and a create-job preflight guard.

- [ ] Write failing source-contract assertions for the protected route, owned asset ID input, structured 422 response, and pre-queue service call.
- [ ] Run `bun test tests/unit/qwen-voice-preflight-api.test.ts` and verify failure.
- [ ] Add the OpenAPI route and call the same service in the Qwen create-job branch before `store.create`.
- [ ] Regenerate OpenAPI and SDK with `bun run api:spec && bun run api:generate`.
- [ ] Run the API test and verify it passes.

### Task 3: Modal immediate feedback

**Files:**
- Modify: `web/api/api-client.ts`
- Modify: `web/features/voice-clone/qwen-voice-clone-modal.tsx`
- Modify: `tests/unit/qwen-voice-clone-ui.test.ts`

**Interfaces:**
- Consumes: the preflight API.
- Produces: selection-time loading, success duration, field error, and submit-disable behavior.

- [ ] Add failing assertions for `preflightQwenVoiceSample`, `sampleChecking`, the actual-duration message, and disabled submit.
- [ ] Run `bun test tests/unit/qwen-voice-clone-ui.test.ts` and verify failure.
- [ ] Implement preflight on selection, clear stale success on reselection, display the returned result, and block submission until valid.
- [ ] Run the UI test and verify it passes.

### Task 4: Verification

**Files:**
- Verify all modified files.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: a tested pre-queue validation workflow.

- [ ] Run `make lint`.
- [ ] Run `make test`.
- [ ] Run `bun run typecheck && bun run build`.
- [ ] Run `git diff --check` and verify no unrelated source changes.
