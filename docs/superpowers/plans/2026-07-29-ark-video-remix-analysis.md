# Ark Video Remix Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route video-remix analysis through an Ark multimodal video-understanding model instead of AIHubMix Gemini.

**Architecture:** Add a dedicated Ark chat-completions client for multimodal analysis; it shares only Ark credential retrieval with the Seedance client. The Worker preserves materialization and result contracts, replacing the provider call and provenance while surfacing structured Ark failures.

**Tech Stack:** Bun, TypeScript, Hono configuration, Ark OpenAI-compatible API, Bun Test.

## Global Constraints

- Do not fall back silently to AIHubMix or a mock provider.
- Do not log API keys, signed URLs, inline media or complete upstream response bodies.
- Preserve existing worker job persistence, cancellation and `analysisEntries` result contracts.
- Use the verified Ark model list to choose the configured default; do not invent a model ID.

---

### Task 1: Verify the Ark model and define the client contract

**Files:**
- Create: `server/providers/ark-video-analysis.ts`
- Create: `tests/unit/ark-video-analysis.test.ts`

**Interfaces:**
- Produces: `ArkVideoAnalysisClient.analyzeVideo(input): Promise<{ text: string; model: string }>` and `ArkVideoAnalysisError` with sanitized provider diagnostics.

- [ ] **Step 1: List models with the configured Ark credential**

Run: `bun -e 'import { arkSeedance } from "./server/providers/ark-seedance"; console.log((await arkSeedance.listModels()).map((model) => model.id).filter((id) => /vision|seed/i.test(id)).join("\\n"))'`

Expected: an Ark video-capable visual model ID available to the configured account.

- [ ] **Step 2: Write failing request/response tests**

```ts
expect(captured.url).toBe("https://ark.example.test/api/v3/chat/completions");
expect(captured.body.messages[0].content).toContainEqual({ type: "video_url", video_url: { url: "data:video/mp4;base64,..." } });
expect(result.text).toBe("解析结果");
```

- [ ] **Step 3: Implement the minimal Ark analysis client**

```ts
class ArkVideoAnalysisClient {
  analyzeVideo(input) {
    // Read local video and product references, submit one Ark chat request, extract message.content.
  }
}
```

- [ ] **Step 4: Run client tests**

Run: `bun test tests/unit/ark-video-analysis.test.ts`

Expected: PASS.

### Task 2: Switch the video-remix Worker to Ark provenance

**Files:**
- Modify: `worker/jobs/job-video-remix-analysis.ts`
- Modify: `server/env.ts` or the existing app config source for the Ark analysis model ID
- Test: `tests/unit/ark-video-analysis.test.ts`

**Interfaces:**
- Consumes: `ArkVideoAnalysisClient.analyzeVideo` from Task 1.
- Produces: real Ark `video-understand` provenance and existing analysis artifacts.

- [ ] **Step 1: Write a failing worker source contract test**

```ts
expect(workerSource).toContain('provider: "ark"');
expect(workerSource).toContain("arkVideoAnalysis.analyzeVideo");
expect(workerSource).not.toContain("analyzeVideoWithGemini");
```

- [ ] **Step 2: Replace the provider import and call**

```ts
const analysis = await arkVideoAnalysis.analyzeVideo({ videoPath, prompt, model: env.arkVideoAnalysisModel, productImages });
```

- [ ] **Step 3: Preserve structured failure details**

```ts
if (error instanceof ArkVideoAnalysisError) analysisStage.failure = error.failure;
```

- [ ] **Step 4: Run focused worker/client tests**

Run: `bun test tests/unit/ark-video-analysis.test.ts`

Expected: PASS.

### Task 3: Verify provider readiness and build

**Files:**
- Modify: only files from Tasks 1-2.

**Interfaces:**
- Consumes: the selected verified Ark model.
- Produces: buildable provider replacement.

- [ ] **Step 1: Format and run focused tests**

Run: `bunx biome check --write server/providers/ark-video-analysis.ts worker/jobs/job-video-remix-analysis.ts tests/unit/ark-video-analysis.test.ts && bun test tests/unit/ark-video-analysis.test.ts`

- [ ] **Step 2: Run type and production build verification**

Run: `bun run typecheck && bun run build`

Expected: both commands exit successfully.

- [ ] **Step 3: Run a single real Ark model-list validation**

Run: `bun -e 'import { arkSeedance } from "./server/providers/ark-seedance"; console.log((await arkSeedance.listModels()).length)'`

Expected: a positive model count; do not print credentials.
