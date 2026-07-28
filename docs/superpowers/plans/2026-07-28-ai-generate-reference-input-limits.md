# AI 创作参考素材规则提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 AI 创作的单一“添加参考素材”入口中，让素材库选择和本地上传都明确并执行 Seedance 图片、视频的格式、大小、数量与时长限制。

**Architecture:** 扩展共享 `AttachmentPicker` 的可选限制配置，使它在弹窗顶部展示规则、在素材库中禁用不合规素材、并在本地选择上传前拦截可判定的文件。AI 创作页仅根据当前模型传入限制；服务端与 Worker 继续作为不可绕过的最终校验层。

**Tech Stack:** React 19、TypeScript、TanStack Query、现有 shadcn Button/FileUpload、Bun Test、Biome。

## Global Constraints

- 不修改 `web/api/generated/` 或 OpenAPI 生成产物。
- 使用已有单一素材入口，同时支持本地上传与素材库选择。
- Seedance 参考限制：图片 `≤10MB`、视频 `≤200MB 且 ≤15.2 秒`、图片最多 9 个、视频最多 3 个、总计最多 12 个。
- 保留 owner 隔离与服务端/Worker 最终验证；前端规则仅用于提前反馈。
- 使用现有 `type-*` 排版、共享 Button 和结构性 hairline，不新增全局视觉语言。

---

### Task 1: 为共享素材选择器建立可复用的限制契约

**Files:**
- Modify: `web/components/domain/attachment-picker.tsx`
- Test: `tests/unit/attachment-picker-preview.test.ts`

**Interfaces:**
- Produces: `AttachmentPicker` 的可选 `constraints` 属性，包含每种 MIME 大类的 `maxBytes`、`maxDurationSec`、`maxCount` 和显示文案。
- Consumes: `LibraryAsset.size`、`LibraryAsset.durationSec` 和浏览器 `File.size`。

- [ ] **Step 1: Write the failing test**

```ts
expect(source).toContain("constraints?: AttachmentPickerConstraints");
expect(source).toContain("素材规则");
expect(source).toContain("素材大小超过限制");
expect(source).toContain("视频时长不能超过");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/attachment-picker-preview.test.ts`

Expected: FAIL because the picker has no limit configuration or validation copy.

- [ ] **Step 3: Write minimal implementation**

```ts
export type AttachmentPickerConstraints = {
  summary: string[];
  byKind?: Partial<Record<"image" | "video", { maxBytes?: number; maxDurationSec?: number; maxCount?: number }>>;
};

function constraintReason(asset: Pick<LibraryAsset, "mimeType" | "size" | "durationSec">, constraints?: AttachmentPickerConstraints) {
  // Return a Chinese reason for size/duration violations; return undefined when valid or unknown.
}
```

Render `summary` below the dialog source tabs. Disable invalid library asset cards, preserve preview access, and block invalid local files before calling `uploadMediaFile`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/attachment-picker-preview.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/domain/attachment-picker.tsx tests/unit/attachment-picker-preview.test.ts
git commit -m "feat: validate attachment picker media limits"
```

### Task 2: 将当前 Seedance 规则接入 AI 创作入口

**Files:**
- Modify: `web/features/ai-generate/ai-generate-page.tsx`
- Modify: `web/features/ai-generate/ai-generate-runtime.ts`
- Test: `tests/unit/ai-generate-runtime.test.ts`
- Test: `tests/unit/ai-generate-page.test.ts`

**Interfaces:**
- Consumes: `CreationModelCapability.acceptedReferenceKinds`、`AttachmentPickerConstraints`。
- Produces: `seedanceReferenceConstraints(model)`，仅对支持视频参考的当前模型传入图片/视频限制与用户可读规则。

- [ ] **Step 1: Write the failing test**

```ts
expect(seedanceReferenceConstraints({ acceptedReferenceKinds: ["image", "video"] })).toEqual(
  expect.objectContaining({ summary: expect.arrayContaining([expect.stringContaining("15.2")]) }),
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/ai-generate-runtime.test.ts tests/unit/ai-generate-page.test.ts`

Expected: FAIL because the AI creation runtime has no constraint adapter.

- [ ] **Step 3: Write minimal implementation**

```tsx
<AttachmentPicker
  accept={accept}
  constraints={seedanceReferenceConstraints(model)}
  multiple
  showMediaTypeFilters
  onSelect={(assets) => void addAssets(assets)}
  trigger={...}
/>
```

Only show rules for types accepted by the selected model. Keep image-only models free of video-specific copy.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/ai-generate-runtime.test.ts tests/unit/ai-generate-page.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/features/ai-generate/ai-generate-page.tsx web/features/ai-generate/ai-generate-runtime.ts tests/unit/ai-generate-runtime.test.ts tests/unit/ai-generate-page.test.ts
git commit -m "feat: show Seedance reference media limits"
```

### Task 3: 验证完整交互构建

**Files:**
- Verify only: changed files from Tasks 1–2

**Interfaces:**
- Consumes: picker and AI-creation runtime behavior from prior tasks.
- Produces: validated local production build.

- [ ] **Step 1: Run focused tests**

Run: `bun test tests/unit/attachment-picker-preview.test.ts tests/unit/ai-generate-runtime.test.ts tests/unit/ai-generate-page.test.ts`

Expected: PASS.

- [ ] **Step 2: Run type and build verification**

Run: `bun run typecheck && bun run build`

Expected: PASS; Vite may retain its existing large-chunk warning.

- [ ] **Step 3: Inspect the scoped diff**

Run: `git diff --check -- web/components/domain/attachment-picker.tsx web/features/ai-generate/ai-generate-page.tsx web/features/ai-generate/ai-generate-runtime.ts tests/unit/attachment-picker-preview.test.ts tests/unit/ai-generate-runtime.test.ts tests/unit/ai-generate-page.test.ts`

Expected: no whitespace errors and no unrelated source edits.

- [ ] **Step 4: Commit**

```bash
git add web/components/domain/attachment-picker.tsx web/features/ai-generate/ai-generate-page.tsx web/features/ai-generate/ai-generate-runtime.ts tests/unit/attachment-picker-preview.test.ts tests/unit/ai-generate-runtime.test.ts tests/unit/ai-generate-page.test.ts
git commit -m "feat: clarify AI reference media requirements"
```

## Self-Review

- Spec coverage: Task 1 covers shared local/library behavior and in-dialog messages; Task 2 scopes the concrete Seedance rules to the selected model; Task 3 verifies the complete integration.
- Placeholder scan: no TBD/TODO markers or unspecified validation actions remain.
- Type consistency: `AttachmentPickerConstraints` is produced by Task 1 and consumed by Task 2; the runtime helper returns the exact property expected by the picker.
