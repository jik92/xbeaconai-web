# Qwen-only Voice Clone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Qwen the only provider for newly created voice-clone tasks while preserving historical Volcengine retries.

**Architecture:** The Web exposes only the Qwen modal, and the create-job API rejects every non-Qwen voice-clone
submission before provider gating or queueing. Feature availability depends only on Qwen Audio plus TOS. The existing
Volcengine Worker handler and Provider remain registered so retrying persisted historical jobs still works.

**Tech Stack:** Bun Test, TypeScript, React 19, Hono, BullMQ Worker registry

## Global Constraints

- Keep the Volcengine Provider, Worker handler, scripts, credentials, diagnostics, and historical data.
- Allow historical Volcengine jobs to retry through the existing retry API.
- Do not expose a new Volcengine voice-clone creation path through Web or the create-job API.
- Do not manually edit generated SDK files.
- Do not run E2E tests unless the user explicitly requests them.

---

### Task 1: Make the Web creation flow Qwen-only

**Files:**
- Modify: `tests/unit/qwen-voice-clone-ui.test.ts`
- Modify: `web/components/domain/module-page.tsx`
- Modify: `web/features/voice-clone/qwen-voice-clone-modal.tsx`

**Interfaces:**
- Consumes: `QwenVoiceCloneModal` and `ToolTaskPage.onAction`
- Produces: one provider-neutral `新建音色人物` action that opens the Qwen modal

- [ ] **Step 1: Write the failing Web source-contract test**

Update the UI test to assert:

```ts
expect(page).toContain('actionLabel={config.id === "voice-clone" ? "新建音色人物" : newTaskLabel}');
expect(page).toContain('onAction={() => (config.id === "voice-clone" ? setQwenCreatorOpen(true) : setCreatorOpen(true))}');
expect(page).not.toContain("secondaryAction=");
expect(page).not.toContain("config.id === \"voice-clone\" ? generatedTitle");
expect(modal).toContain('title="新建音色人物"');
```

- [ ] **Step 2: Run the test and verify the old dual-entry UI fails**

Run: `bun test tests/unit/qwen-voice-clone-ui.test.ts`

Expected: FAIL because the page still exposes the generic legacy action plus a secondary Qwen action.

- [ ] **Step 3: Route the sole page action to the Qwen modal**

In `ModulePage`, remove the voice-clone secondary action and make the primary action and empty-state action open
`QwenVoiceCloneModal` when `config.id === "voice-clone"`. Do not render the generic `ToolCreatorModal` content for
voice-clone. Rename the Qwen modal title to `新建音色人物`.

- [ ] **Step 4: Run the Web test**

Run: `bun test tests/unit/qwen-voice-clone-ui.test.ts tests/unit/tool-page-layout.test.tsx`

Expected: PASS.

### Task 2: Reject new Volcengine jobs while preserving historical routing

**Files:**
- Modify: `tests/unit/qwen-voice-clone-api.test.ts`
- Modify: `tests/unit/worker-job-registry.test.ts`
- Modify: `server/app.ts`

**Interfaces:**
- Consumes: `body.values.voiceProvider`, `validateQwenVoiceCloneValues`
- Produces: synchronous `422` error code `QWEN_VOICE_CLONE_REQUIRED` for non-Qwen new submissions

- [ ] **Step 1: Write failing API and compatibility assertions**

Replace legacy-default expectations with:

```ts
expect(source).toContain('moduleId === "voice-clone" && body.values.voiceProvider !== "qwen"');
expect(source).toContain('code: "QWEN_VOICE_CLONE_REQUIRED"');
expect(source).not.toContain('providerFeatureAvailability(["volc-speech"])');
expect(source).not.toContain('jobValues.presetVoiceId = "zh_female_vv_uranus_bigtts"');
```

Keep Worker registry assertions proving both routes still exist:

```ts
expect(findJobHandler(job("voice-clone")).name).toBe("voice-clone");
expect(findJobHandler(job("voice-clone", { voiceProvider: "qwen" })).name).toBe("qwen-voice-clone");
```

- [ ] **Step 2: Run the tests and verify the API contract fails**

Run: `bun test tests/unit/qwen-voice-clone-api.test.ts tests/unit/worker-job-registry.test.ts`

Expected: API test FAIL; Worker compatibility test PASS.

- [ ] **Step 3: Add the create-only provider guard**

Immediately after parsing the create-job request body, return the standard structured `422` response when
`moduleId === "voice-clone"` and `voiceProvider !== "qwen"`:

```ts
{
  error: {
    code: "QWEN_VOICE_CLONE_REQUIRED",
    message: "新建音色克隆任务仅支持 Qwen",
    retryable: false,
    requestId: crypto.randomUUID(),
  },
}
```

Then simplify voice-clone availability and validation to the Qwen path. Do not change the retry route or Worker registry.

- [ ] **Step 4: Run API and Worker tests**

Run: `bun test tests/unit/qwen-voice-clone-api.test.ts tests/unit/worker-job-registry.test.ts`

Expected: PASS.

### Task 3: Make feature availability Qwen-only

**Files:**
- Modify: `tests/unit/provider-feature-gate.test.ts`
- Modify: `server/byok/provider-feature-gate.ts`

**Interfaces:**
- Produces: `moduleProviderRequirements["voice-clone"] === ["qwen-audio", "tos"]`

- [ ] **Step 1: Write the failing feature-gate test**

Assert:

```ts
expect(moduleProviderRequirements["voice-clone"]).toEqual(["qwen-audio", "tos"]);
expect(moduleFeatureAvailability("voice-clone", (providerId) => providerId === "volc-speech").enabled).toBe(false);
```

Keep the existing Qwen-plus-TOS enabled and missing-TOS disabled checks.

- [ ] **Step 2: Run the feature-gate test and verify it fails**

Run: `bun test tests/unit/provider-feature-gate.test.ts`

Expected: FAIL because Volcengine currently enables the module.

- [ ] **Step 3: Remove the voice-clone fallback**

Set the static requirement to:

```ts
"voice-clone": ["qwen-audio", "tos"],
```

Remove the `moduleFeatureAvailability` special case so all modules use their static provider requirements.

- [ ] **Step 4: Run the feature-gate test**

Run: `bun test tests/unit/provider-feature-gate.test.ts`

Expected: PASS.

### Task 4: Regenerate contracts if needed and verify the repository

**Files:**
- Modify only if the OpenAPI contract changes: `openapi/openapi.json`, `web/api/generated/*`

**Interfaces:**
- Produces: verified repository state

- [ ] **Step 1: Check whether the route schema changed**

The planned change uses an existing `422` response schema and should not alter OpenAPI. Run `git diff -- server/app.ts`
and do not regenerate generated files unless the route contract changed.

- [ ] **Step 2: Run focused tests**

Run:

```bash
bun test tests/unit/qwen-voice-clone-ui.test.ts tests/unit/qwen-voice-clone-api.test.ts \
  tests/unit/provider-feature-gate.test.ts tests/unit/worker-job-registry.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the complete delivery baseline**

Run:

```bash
make ci
bun run typecheck
bun run build
```

Expected: all commands exit `0`. Existing lint warnings may remain, but no errors are allowed.

- [ ] **Step 4: Review scope**

Run:

```bash
git diff --check
git status --short
git diff -- web/components/domain/module-page.tsx web/features/voice-clone/qwen-voice-clone-modal.tsx \
  server/app.ts server/byok/provider-feature-gate.ts tests/unit/qwen-voice-clone-ui.test.ts \
  tests/unit/qwen-voice-clone-api.test.ts tests/unit/provider-feature-gate.test.ts \
  tests/unit/worker-job-registry.test.ts
```

Confirm no Volcengine Provider, Worker handler, scripts, credentials, or historical data were deleted.
