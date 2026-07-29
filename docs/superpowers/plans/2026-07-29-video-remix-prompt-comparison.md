# Video Remix Prompt Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require users to review an obvious before-and-after prompt diff before a video-remix AI rewrite is applied.

**Architecture:** Keep the existing `PromptToolModal` as the sole review surface. Store each completed rewrite as pending review metadata, render the existing line diff for all tools, and invoke `onApply` only from the explicit confirmation action.

**Tech Stack:** React 19, TypeScript, Bun Test, Tailwind CSS, existing `buildLineDiff` utility.

## Global Constraints

- Reuse `buildLineDiff`; add no dependencies.
- Do not change generated API files or OpenAPI contracts.
- Keep original prompt text until the user presses the explicit apply action.
- Preserve existing task polling and error handling.

---

### Task 1: Lock in the pending-review contract

**Files:**
- Modify: `tests/unit/video-remix-prompt-tools.test.ts`
- Modify: `web/features/video-remix/prompt-tool-modal.tsx`

**Interfaces:**
- Consumes: `PromptToolModal` completed job values `rewrittenPrompt`, `rewriteSummary`, and `rewriteFindings`.
- Produces: a pending review state that carries `tool`, `summary`, and `findings` until explicit confirmation.

- [ ] **Step 1: Write the failing test**

```ts
expect(modal).toContain("pendingRewrite");
expect(modal).toContain("修改前后对比");
expect(modal).toContain("应用修改");
expect(modal).not.toContain("onApply(currentTool, rewritten, summary, findings)");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/video-remix-prompt-tools.test.ts`

Expected: FAIL because the modal still contains the direct success-path apply call and has no universal pending review state.

- [ ] **Step 3: Write minimal implementation**

```ts
setPendingRewrite({ tool: currentTool, summary, findings });
setOriginalPreview(prompt);
setPreview(rewritten);
```

Use `showRewriteDiff = Boolean(pendingRewrite) && comparisonPreview !== originalPreview`; render the same paired `DiffColumn` components for every tool.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/video-remix-prompt-tools.test.ts`

Expected: PASS.

### Task 2: Allow review edits and explicit application

**Files:**
- Modify: `web/features/video-remix/prompt-tool-modal.tsx`
- Modify: `web/features/video-remix/remix-project.css`
- Test: `tests/unit/video-remix-prompt-tools.test.ts`

**Interfaces:**
- Consumes: pending review metadata and current preview text.
- Produces: `saveRewrite()` which calls `onApply(tool, rewritten, summary, findings)` only after the user chooses “应用修改”.

- [ ] **Step 1: Extend the failing test**

```ts
expect(modal).toContain("编辑修改后内容");
expect(modal).toContain("继续编辑");
expect(modal).toContain("应用修改");
expect(modal).toContain("saveRewrite");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/video-remix-prompt-tools.test.ts`

Expected: FAIL until generic edit and confirm actions exist.

- [ ] **Step 3: Write minimal implementation**

```ts
const saveRewrite = () => {
  if (!pendingRewrite || comparisonPreview === originalPreview) return;
  onApply(pendingRewrite.tool, comparisonPreview, pendingRewrite.summary, pendingRewrite.findings);
  setOriginalPreview(comparisonPreview);
  setPreview(comparisonPreview);
  setPendingRewrite(null);
};
```

Use the existing diff styles, update labels to generic “修改前/修改后”, and retain the primary button styling for the confirmation action.

- [ ] **Step 4: Run focused verification**

Run: `bun test tests/unit/video-remix-prompt-tools.test.ts && bun run typecheck && bun run build`

Expected: all commands exit 0.
