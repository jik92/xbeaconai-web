# AI 创作参考素材可见性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 AI 创作中让用户在选择、提交前和历史对话中都能看清参考图片或视频，避免发错素材并支持结果复盘。

**Architecture:** 复用 `AttachmentPicker` 现有的素材库详情预览作为选择阶段的全尺寸预览。新增一个 `AiGenerateReferencePreview` 组件，由输入框附件和历史任务 `referenceMetadata` 共同驱动；它通过现有认证媒体预览能力渲染图片缩略图和视频封面，不改变素材上传、任务契约或 Seedance 提交链路。

**Tech Stack:** React 19、Assistant UI、TypeScript、Tailwind CSS、Bun Test。

## Global Constraints

- 使用现有 `AttachmentPicker`、`Button` 与认证媒体预览组件，不增加依赖。
- 图片与视频都必须可见；素材 URL 仅使用现有受鉴权 API 地址。
- 只改 AI 创作页面与对应测试；不改生成 API 契约或 Worker 提交逻辑。
- 使用 TypeScript strict、Biome 格式，并且不运行 E2E。

---

### Task 1: 定义可复用的对话参考素材预览

**Files:**

- Create: `web/features/ai-generate/ai-generate-reference-preview.tsx`
- Test: `tests/unit/ai-generate-reference-preview.test.ts`

**Interfaces:**

- Consumes: `AiGenerateReference`（`id`、`name`、`mimeType`、`label`、`url`）。
- Produces: `AiGenerateReferencePreview({ references, removable, onRemove? })`。

- [ ] **Step 1: Write the failing test**

```ts
expect(source).toContain("AuthenticatedMedia");
expect(source).toContain("reference.url");
expect(source).toContain("onRemove?.(reference.id)");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/ai-generate-reference-preview.test.ts`

Expected: FAIL because the preview component file does not exist.

- [ ] **Step 3: Write minimal implementation**

```tsx
export function AiGenerateReferencePreview({ references, removable = false, onRemove }: Props) {
  return <div>{references.map((reference) => <AuthenticatedMedia url={reference.url} mimeType={reference.mimeType} />)}</div>;
}
```

Render each image/video thumbnail, its `@图片N` or `@视频N` label, filename, and an optional shared Button removal action.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/ai-generate-reference-preview.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add web/features/ai-generate/ai-generate-reference-preview.tsx tests/unit/ai-generate-reference-preview.test.ts && git commit -m "feat: preview AI creation reference media"`

### Task 2: 在提交前的输入框中显示和移除素材

**Files:**

- Modify: `web/features/ai-generate/ai-generate-page.tsx: ComposerAttachment, AiGenerateComposer`
- Modify: `tests/unit/ai-generate-page.test.ts`

**Interfaces:**

- Consumes: `AiGenerateReferencePreview` 与 Assistant UI `composer.clearAttachments()` / `composer.addAttachment()`。
- Produces: 输入框上方的一组可见参考媒体和按素材 ID 删除的交互。

- [ ] **Step 1: Write the failing test**

```ts
expect(page).toContain("AiGenerateReferencePreview");
expect(page).toContain("removeReference");
expect(page).toContain("参考素材");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/ai-generate-page.test.ts`

Expected: FAIL because the composer does not render the shared preview component or remove handler.

- [ ] **Step 3: Write minimal implementation**

```tsx
<AiGenerateReferencePreview references={attachedReferences} removable onRemove={(id) => void removeReference(id)} />
```

Implement `removeReference(id)` by retaining every Assistant UI attachment except the one containing that reference ID, clearing the composer, then adding the retained attachments back in order.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/ai-generate-page.test.ts tests/unit/ai-generate-reference-preview.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add web/features/ai-generate/ai-generate-page.tsx tests/unit/ai-generate-page.test.ts && git commit -m "feat: show selected AI creation references in composer"`

### Task 3: 在已提交的用户消息中保留参考媒体

**Files:**

- Modify: `web/features/ai-generate/ai-generate-page.tsx: UserMessage`
- Modify: `tests/unit/ai-generate-page.test.ts`

**Interfaces:**

- Consumes: `ThreadMessageLike.metadata.custom.references` created by `jobsToThreadMessages`.
- Produces: 每个历史用户消息气泡中的只读 `AiGenerateReferencePreview`。

- [ ] **Step 1: Write the failing test**

```ts
expect(page).toContain("metadata?.custom?.references");
expect(page).toContain("removable={false}");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/ai-generate-page.test.ts`

Expected: FAIL because `UserMessage` currently只渲染文本 Parts。

- [ ] **Step 3: Write minimal implementation**

```tsx
const references = useAuiState((state) => state.message.metadata?.custom?.references ?? []);
return <AiGenerateReferencePreview references={references} removable={false} />;
```

Use the Assistant UI message selector supported by the current package if the exact state path differs; preserve the existing message text bubble alignment.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/ai-generate-page.test.ts tests/unit/ai-generate-runtime.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add web/features/ai-generate/ai-generate-page.tsx tests/unit/ai-generate-page.test.ts && git commit -m "feat: retain AI creation references in chat history"`

### Task 4: 验证视觉与工程集成

**Files:**

- Modify: `web/styles/globals.css` only if preview layout cannot be represented by existing Tailwind utilities.
- Test: `tests/unit/ai-generate-reference-preview.test.ts`, `tests/unit/ai-generate-page.test.ts`, `tests/unit/attachment-picker-preview.test.ts`, `tests/unit/ai-generate-runtime.test.ts`

**Interfaces:**

- Consumes: Tasks 1–3。
- Produces: 可在窄输入框中换行、不遮挡发送按钮的预览布局。

- [ ] **Step 1: Write a failing responsive source assertion only if new CSS is required**

```ts
expect(styles).toContain(".ai-generate-reference-preview");
```

- [ ] **Step 2: Run targeted tests**

Run: `bun test tests/unit/ai-generate-reference-preview.test.ts tests/unit/ai-generate-page.test.ts tests/unit/attachment-picker-preview.test.ts tests/unit/ai-generate-runtime.test.ts`

Expected: PASS.

- [ ] **Step 3: Run type and build verification**

Run: `bun run typecheck && bun run build`

Expected: both commands exit 0.

- [ ] **Step 4: Review scope**

Run: `git diff --check && git diff -- web/features/ai-generate tests/unit web/styles/globals.css`

Expected: no whitespace errors and no unrelated source changes.

- [ ] **Step 5: Commit**

Run: `git add web/features/ai-generate tests/unit/ai-generate-reference-preview.test.ts tests/unit/ai-generate-page.test.ts && git commit -m "feat: make AI creation references traceable"`

## Self-Review

- Spec coverage: Task 1 preserves preview while choosing; Task 2 shows selected materials before submission; Task 3 retains them in chat history; Task 4 validates responsive and engineering integration.
- Placeholder scan: no unresolved implementation placeholders or unspecified files remain.
- Type consistency: all consumers use the existing `AiGenerateReference` shape and the single preview component interface defined in Task 1.
