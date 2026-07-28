# AI 创作产品对话 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add named product conversations so AI Generate histories, drafts, and revisions stay separated by product.

**Architecture:** Persist an optional conversation identifier and name inside each existing AI Generate job request/value record. The page derives product conversation groups from fetched jobs, filters assistant messages to the active group, and propagates a source job's group during revisions. Legacy jobs are mapped to a virtual unclassified group.

**Tech Stack:** React 19, assistant-ui, TanStack Query, Hono/Zod OpenAPI, Bun Test, TypeScript.

## Global Constraints

- Keep generated API client files untouched; regenerate them after API schema changes.
- Use TypeScript strict mode and existing UI primitives; no new dependency.
- Preserve task parent lineage and reference attachments on edit and variant submission.
- Use the product name only as grouping metadata, never as a model prompt prefix.

---

### Task 1: Extend the AI Generate request contract

**Files:**
- Modify: `server/creation/ai-generate-contract.ts`
- Modify: `web/features/ai-generate/ai-generate-runtime.ts`
- Test: `tests/unit/ai-generate-runtime.test.ts`

**Interfaces:**
- Produces optional `conversationId?: string` and `conversationName?: string` fields on `AiGenerateRequest` and `AiGenerateDraft`.
- `buildAiGenerateRequest(draft, title)` includes both fields when present.

- [ ] **Step 1: Write the failing test**

```ts
expect(buildAiGenerateRequest({ ...draft, conversationId: "uuid", conversationName: "桑蚕丝女裤" }, "视频创作"))
  .toMatchObject({ conversationId: "uuid", conversationName: "桑蚕丝女裤" });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/ai-generate-runtime.test.ts`

- [ ] **Step 3: Write minimal implementation**

```ts
conversationId: z.string().uuid().optional(),
conversationName: z.string().trim().min(1).max(80).optional(),
// normalize request fields into the persisted values record
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/ai-generate-runtime.test.ts`

### Task 2: Add conversation grouping helpers

**Files:**
- Modify: `web/features/ai-generate/ai-generate-runtime.ts`
- Test: `tests/unit/ai-generate-runtime.test.ts`

**Interfaces:**
- Produces `groupAiGenerateConversations(jobs)` returning stable `{ id, name, jobs }` records.
- Legacy jobs map to `{ id: "unclassified", name: "未分类" }`.

- [ ] **Step 1: Write the failing test**

```ts
expect(groupAiGenerateConversations([legacyJob, namedJob])).toEqual([
  expect.objectContaining({ id: namedJob.values.conversationId, name: "桑蚕丝女裤" }),
  expect.objectContaining({ id: "unclassified", name: "未分类" }),
]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/ai-generate-runtime.test.ts`

- [ ] **Step 3: Write minimal implementation**

```ts
export const UNCLASSIFIED_CONVERSATION_ID = "unclassified";
export function groupAiGenerateConversations(jobs: Job[]): AiGenerateConversation[] { /* group and sort latest first */ }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/ai-generate-runtime.test.ts`

### Task 3: Render and operate the product conversation rail

**Files:**
- Modify: `web/features/ai-generate/ai-generate-page.tsx`
- Test: `tests/unit/ai-generate-page.test.ts`

**Interfaces:**
- Provider exposes active conversation and `createConversation(name)`.
- Submissions use active conversation metadata; restore/variant use source-job metadata.

- [ ] **Step 1: Write the failing page test**

```ts
expect(page).toContain("新建对话");
expect(page).toContain("groupAiGenerateConversations(jobs)");
expect(page).toContain("activeConversationId");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/ai-generate-page.test.ts`

- [ ] **Step 3: Implement the rail and propagation**

```tsx
<Button onClick={() => setCreateDialogOpen(true)}>新建对话</Button>
// use active conversation to filter messages and apply its id/name to new submissions
// derive revision group from source.values.conversationId/conversationName
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/ai-generate-page.test.ts`

### Task 4: Regenerate contract and verify

**Files:**
- Generated: `openapi/openapi.json`, `web/api/generated/`

- [ ] **Step 1: Regenerate API contract**

Run: `bun run api:spec && bun run api:generate`

- [ ] **Step 2: Run focused verification**

Run: `bun test tests/unit/ai-generate-runtime.test.ts tests/unit/ai-generate-page.test.ts && bun run typecheck && bun run build`

- [ ] **Step 3: Review diff**

Run: `git diff --check && git diff -- server/creation/ai-generate-contract.ts web/features/ai-generate/ai-generate-runtime.ts web/features/ai-generate/ai-generate-page.tsx`
