# Qwen Voice Form Autosave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the Qwen voice-person form, add instruction-based speed control, and optionally save the generated WAV to the user's default asset folder.

**Architecture:** Keep the Qwen modal and Worker isolated from the legacy Volc path. Extend shared Qwen instruction construction with a typed speed value, normalize safe server defaults, and make the Qwen Worker choose between a library asset and a task artifact.

**Tech Stack:** Bun, TypeScript, React 19, Hono, Drizzle account store, TOS, Bun Test.

## Global Constraints

- Do not change the existing Volc voice form or Worker behavior.
- Only expose the official Qwen dialect catalog.
- Qwen speed is controlled through `instruction`, not an undocumented numeric API field.
- Automatic saving defaults to enabled and targets the authenticated user's default asset folder.
- Do not run E2E tests.

---

### Task 1: Shared speed contract and provider request

**Files:**
- Modify: `shared/voice/qwen-voice.ts`
- Modify: `server/providers/qwen-audio.ts`
- Modify: `tests/unit/qwen-audio-provider.test.ts`

**Interfaces:**
- Produces: `qwenVoiceSpeeds`, `QwenVoiceSpeed`, `isQwenVoiceSpeed`, and `qwenVoiceInstruction(dialect, style, speed)`.
- Consumes: existing official dialect and style contracts.

- [ ] **Step 1: Add failing assertions**

Assert that slow, standard, and fast speed values produce distinct natural-language instructions and that `QwenAudioProvider.synthesize` passes the selected speed into the request instruction.

- [ ] **Step 2: Run the provider test**

Run: `bun test tests/unit/qwen-audio-provider.test.ts`

Expected: FAIL because the speed contract is missing.

- [ ] **Step 3: Implement the typed speed contract**

Add the three speed values and append the matching phrase to the existing dialect/style instruction.

- [ ] **Step 4: Run the provider test**

Run: `bun test tests/unit/qwen-audio-provider.test.ts`

Expected: PASS.

### Task 2: Simplified modal and API validation

**Files:**
- Modify: `web/features/voice-clone/qwen-voice-clone-modal.tsx`
- Modify: `server/voice/validate-qwen-voice-clone.ts`
- Modify: `server/app.ts`
- Modify: `tests/unit/qwen-voice-clone-ui.test.ts`
- Modify: `tests/unit/voice-task-validation.test.ts`
- Modify: `tests/unit/qwen-voice-clone-api.test.ts`

**Interfaces:**
- Consumes: `qwenVoiceSpeeds` and `isQwenVoiceSpeed`.
- Produces: Qwen job values `speechSpeed`, `autoSave`, and server-generated audit values.

- [ ] **Step 1: Add failing UI and validation assertions**

Assert that removed labels are absent, “音频转换文本” and the speed selector are present, automatic saving defaults to true, and Qwen validation accepts the simplified payload.

- [ ] **Step 2: Run focused tests**

Run: `bun test tests/unit/qwen-voice-clone-ui.test.ts tests/unit/voice-task-validation.test.ts tests/unit/qwen-voice-clone-api.test.ts`

Expected: FAIL on the old fields and missing defaults.

- [ ] **Step 3: Simplify the modal**

Remove the four fields, auto-generate the title, rename the text label, and submit `speechSpeed` plus `autoSave`.

- [ ] **Step 4: Normalize server audit values**

Validate the official speed and automatic-save values, then add authenticated submission audit metadata without accepting client-supplied owner identity.

- [ ] **Step 5: Run focused tests**

Run: `bun test tests/unit/qwen-voice-clone-ui.test.ts tests/unit/voice-task-validation.test.ts tests/unit/qwen-voice-clone-api.test.ts`

Expected: PASS.

### Task 3: Save successful Qwen audio to the asset library

**Files:**
- Modify: `worker/jobs/job-qwen-voice-clone.ts`
- Add: `tests/unit/qwen-voice-autosave.test.ts`

**Interfaces:**
- Consumes: job values `autoSave`, generated WAV bytes, `AccountStore.getDefaultAssetFolderId`, `AccountStore.createAsset`, and `ossutils.putLibraryBytes`.
- Produces: a `/api/assets/{assetId}/content` result when enabled, otherwise the existing `/api/artifacts/{artifactId}` result.

- [ ] **Step 1: Add failing source-contract tests**

Assert that automatic saving resolves the owner's default folder, uploads under its generated prefix, creates an audio media asset, and returns an authenticated asset URL.

- [ ] **Step 2: Run the autosave test**

Run: `bun test tests/unit/qwen-voice-autosave.test.ts`

Expected: FAIL because the Worker only creates an Artifact.

- [ ] **Step 3: Implement the save branch**

When `autoSave === "true"`, upload WAV bytes, create the owned media asset, and use it as the result artifact. Keep the task Artifact branch for disabled automatic saving.

- [ ] **Step 4: Run Qwen and registry tests**

Run: `bun test tests/unit/qwen-voice-autosave.test.ts tests/unit/worker-job-registry.test.ts`

Expected: PASS.

### Task 4: Full verification

**Files:**
- Verify all modified files.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a buildable, tested Qwen voice-person workflow.

- [ ] **Step 1: Format and lint**

Run: `make lint`

Expected: formatting passes with no new lint errors.

- [ ] **Step 2: Run all unit tests**

Run: `make test`

Expected: all unit tests pass.

- [ ] **Step 3: Run typecheck and build**

Run: `bun run typecheck && bun run build`

Expected: TypeScript and production build pass.

- [ ] **Step 4: Review the diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and no unrelated source changes.
