# AI Creation Doctor Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Enable AI 创作 image and video models independently when their corresponding Provider credential Doctor check passes.

**Architecture:** Replace `.data/capabilities.json` model-evidence gating in AI creation with persisted `ProviderCredentialStore.isProviderVerified()` checks. Pass separate AIHubMix and Ark booleans into the capability catalog so listing and task submission share the same Provider-specific rule.

**Tech Stack:** Bun, TypeScript strict, Hono, Drizzle SQLite, Bun Test.

## Global Constraints

- AIHubMix Doctor controls all real image models.
- Ark Doctor controls all Seedance video models.
- Provider checks are independent.
- Provider failure never falls back to Mock.
- Do not run E2E.

---

### Task 1: Make capability publication Provider-specific

**Files:**
- Modify: `server/creation/capabilities.ts`
- Test: `tests/unit/creation-capabilities.test.ts`

**Interfaces:**
- Consumes: `creationCapabilities(imageProviderEnabled: boolean, videoProviderEnabled: boolean)`.
- Produces: independently enabled image and video capability arrays.

- [x] **Step 1: Write the failing unit test**

Add assertions for both independent states:

```ts
const imageOnly = creationCapabilities(true, false);
expect(imageOnly.filter((model) => model.kind === "image").every((model) => model.enabled)).toBeTrue();
expect(imageOnly.filter((model) => model.kind === "video").every((model) => !model.enabled)).toBeTrue();

const videoOnly = creationCapabilities(false, true);
expect(videoOnly.filter((model) => model.kind === "image").every((model) => !model.enabled)).toBeTrue();
expect(videoOnly.filter((model) => model.kind === "video").every((model) => model.enabled)).toBeTrue();
```

- [x] **Step 2: Run the test and verify RED**

Run: `bun test tests/unit/creation-capabilities.test.ts`

Expected: FAIL because the current signature accepts a video model callback and one image boolean.

- [x] **Step 3: Implement the two-Provider capability function**

Change the signature to:

```ts
export function creationCapabilities(imageProviderEnabled: boolean, videoProviderEnabled: boolean)
```

Set every image model's `enabled` from `imageProviderEnabled` and every video model's `enabled` from
`videoProviderEnabled`. Keep the existing Provider-specific disabled messages.

- [x] **Step 4: Run the test and verify GREEN**

Run: `bun test tests/unit/creation-capabilities.test.ts`

Expected: PASS.

### Task 2: Replace model evidence gating with Doctor state

**Files:**
- Modify: `server/app.ts`
- Modify: `tests/integration/ai-generate-api-isolated.test.ts`
- Test: `tests/unit/ai-generate-api.test.ts`

**Interfaces:**
- Consumes: `providerCredentials.isProviderVerified("aihubmix" | "ark")`.
- Produces: one `getCreationProviderStatus()` result reused by capability listing and submission validation.

- [x] **Step 1: Write the failing API isolation test**

Persist an `available` AIHubMix check and a non-available Ark check in the temporary database, request
`GET /api/creation/capabilities`, and assert image models are enabled while video models are disabled. Reverse the
checks and assert the reverse state.

- [x] **Step 2: Run the API test and verify RED**

Run: `bun test tests/unit/ai-generate-api.test.ts`

Expected: FAIL because the route still reads `.data/capabilities.json`.

- [x] **Step 3: Implement Doctor-based gating**

Add:

```ts
function getCreationProviderStatus() {
  return {
    imageEnabled: providerCredentials.isProviderVerified("aihubmix"),
    videoEnabled: providerCredentials.isProviderVerified("ark"),
  };
}
```

Replace all AI creation capability and submission call sites with:

```ts
const providers = getCreationProviderStatus();
const models = creationCapabilities(providers.imageEnabled, providers.videoEnabled);
```

Remove `videoModelEnabled()` if no non-creation call site remains. Keep `getVerifiedSdkIds()` only for endpoints that
still intentionally expose model evidence.

- [x] **Step 4: Run API and capability tests**

Run:

```bash
bun test tests/unit/creation-capabilities.test.ts tests/unit/ai-generate-api.test.ts
```

Expected: PASS.

### Task 3: Verify and publish to main

**Files:**
- Modify: `docs/superpowers/plans/2026-07-26-ai-creation-doctor-gating.md`

**Interfaces:**
- Consumes: completed Doctor gating implementation.
- Produces: verified commits on `main` and `origin/main`.

- [x] **Step 1: Audit the production gating source**

Run:

```bash
rg -n 'creationCapabilities|getVerifiedSdkIds|isProviderVerified' server/app.ts server/creation/capabilities.ts
```

Expected: AI creation call sites use Doctor state; model evidence is not part of AI creation gating.

- [x] **Step 2: Run project verification**

Run:

```bash
bun test tests/unit/creation-capabilities.test.ts tests/unit/ai-generate-api.test.ts
bun run typecheck
bun run build
```

Expected: PASS.

- [x] **Step 3: Inspect and commit**

Run:

```bash
git diff --check
git status --short
git add server/creation/capabilities.ts server/app.ts tests/integration/ai-generate-api-isolated.test.ts tests/unit/creation-capabilities.test.ts docs/superpowers/plans/2026-07-26-ai-creation-doctor-gating.md
git commit -m "fix: gate AI creation by Provider Doctor"
```

- [x] **Step 4: Integrate and push main**

Update local `main` safely, merge the feature branch without force, verify the resulting commit, and run:

```bash
git push origin main
```
