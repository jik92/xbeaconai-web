# 素材选择器直接预览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 AI 创作的素材库选择器中默认显示图片分类，并直接展示图片和视频缩略图。

**Architecture:** 扩展 `AttachmentPicker` 的媒体分类状态为图片/视频两项，素材卡复用 `AuthenticatedMedia` 作为封面。AI 创作继续传入模型可接受 MIME 范围，因此只有两个类型均可用时才显示分类切换。

**Tech Stack:** React、TypeScript、TanStack Query、Bun Test。

## Global Constraints

- 不新增独立入口或手写请求。
- 默认图片分类；不显示“全部”。
- 保留素材格式、大小、时长和限制反馈。

---

### Task 1: 图片/视频分类和直接卡片预览

**Files:**
- Modify: `web/components/domain/attachment-picker.tsx`
- Modify: `tests/unit/attachment-picker-preview.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
expect(source).toContain('useState<"image" | "video">("image")');
expect(source).not.toContain('{ id: "all", label: "全部" }');
expect(source).toContain('<AuthenticatedMedia');
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test tests/unit/attachment-picker-preview.test.ts`

Expected: FAIL before the picker state and card preview change.

- [ ] **Step 3: Implement the picker update**

```tsx
const [mediaFilter, setMediaFilter] = useState<"image" | "video">("image");
const visibleAssets = filtered.filter((asset) => asset.mimeType.startsWith(`${mediaFilter}/`));
```

Render `AuthenticatedMedia` inside every asset card and render video metadata beside the card name.

- [ ] **Step 4: Run the focused test**

Run: `bun test tests/unit/attachment-picker-preview.test.ts`

Expected: PASS.

- [ ] **Step 5: Verify build**

Run: `bun run typecheck && bun run build`

Expected: PASS.
