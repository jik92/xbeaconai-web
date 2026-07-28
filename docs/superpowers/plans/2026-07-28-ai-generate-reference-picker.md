# AI 创作参考素材入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 AI 创作的单一入口中支持图片、视频的本地上传和素材库提取，并只展示当前模型支持的类型。

**Architecture:** 扩展共享 `AttachmentPicker`，在素材库中显示可选媒体类型筛选；AI 创作页从 `acceptedReferenceKinds` 推导 MIME `accept`，并在模型变更后删除不兼容的 Assistant UI 附件。引用仍通过既有 `referenceAssetIds` 请求和服务端校验提交。

**Tech Stack:** React 19、TypeScript strict、Assistant UI、TanStack Query、Bun Test、Tailwind CSS、Biome。

## Global Constraints

- 不新增依赖，不修改 `web/api/generated/`。
- 复用 `AttachmentPicker` 与 TOS 直传；不手写上传 API。
- 仅支持图片、视频引用；服务端继续负责最终 MIME 和数量校验。
- 不运行 E2E；完成后运行相关单测、`bun run typecheck`、`bun run build`。

---

### Task 1: 扩展共享选择器的媒体类型筛选

**Files:**
- Modify: `web/components/domain/attachment-picker.tsx`
- Modify: `web/styles/globals.css`
- Test: `tests/unit/attachment-picker-preview.test.ts`

- [ ] 写一个失败的源码断言，要求选择器具有 `showMediaTypeFilters = false`、`aria-label="筛选素材类型"` 与“全部 / 图片 / 视频”按钮。
- [ ] 运行 `bun test tests/unit/attachment-picker-preview.test.ts`，确认因筛选 UI 缺失而失败。
- [ ] 增加 `showMediaTypeFilters?: boolean` 与 `mediaFilter: "all" | "image" | "video"` 状态；只在 `accept` 同时允许图片和视频时显示紧凑筛选按钮；素材库列表按 MIME 顶级类型过滤，上传仍直接使用同一 `accept`。
- [ ] 再次运行该测试，确认通过。
- [ ] 提交该任务：`git add web/components/domain/attachment-picker.tsx web/styles/globals.css tests/unit/attachment-picker-preview.test.ts && git commit -m "feat: filter attachment picker media types"`。

### Task 2: 将模型能力转换为选择器约束

**Files:**
- Modify: `web/features/ai-generate/ai-generate-runtime.ts`
- Test: `tests/unit/ai-generate-runtime.test.ts`

- [ ] 写失败测试：`referenceAccept({ acceptedReferenceKinds: ["image", "video"] })` 返回 `"image/*,video/*"`；仅图片返回 `"image/*"`；空数组返回空字符串。
- [ ] 运行 `bun test tests/unit/ai-generate-runtime.test.ts`，确认失败。
- [ ] 实现并导出 `referenceAccept(model)` 与 `supportsMediaReference(model, mimeType)`，仅规范化 `image` 和 `video`，不把音频加入本次入口。
- [ ] 再次运行该测试，确认通过。
- [ ] 提交该任务：`git add web/features/ai-generate/ai-generate-runtime.ts tests/unit/ai-generate-runtime.test.ts && git commit -m "feat: derive AI reference media capabilities"`。

### Task 3: 接入单一“添加参考素材”入口

**Files:**
- Modify: `web/features/ai-generate/ai-generate-page.tsx`
- Test: `tests/unit/ai-generate-page.test.ts`

- [ ] 写失败测试，断言页面包含“添加参考素材”、`referenceAccept(model)`、`showMediaTypeFilters` 和 `supportsMediaReference`。
- [ ] 运行 `bun test tests/unit/ai-generate-page.test.ts`，确认失败。
- [ ] 将现有 `@ 引用素材` 改为“添加参考素材”；为 `AttachmentPicker` 传入模型对应 `accept` 与 `showMediaTypeFilters`；当模型禁用、没有模型或不支持图片/视频引用时禁用或隐藏入口。
- [ ] 在模型 ID 或可接受引用类型变化时，通过 Assistant UI composer API 删除 MIME 不兼容的附件，并只在实际移除时显示一次 toast；保留兼容附件和所有现有 `@图片N`、`@视频N` 标注逻辑。
- [ ] 运行 `bun test tests/unit/ai-generate-page.test.ts tests/unit/ai-generate-runtime.test.ts tests/unit/attachment-picker-preview.test.ts`，确认通过。
- [ ] 提交该任务：`git add web/features/ai-generate/ai-generate-page.tsx tests/unit/ai-generate-page.test.ts && git commit -m "feat: add AI creation reference media entry"`。

### Task 4: 验证与文档

**Files:**
- Verify: `web/components/domain/attachment-picker.tsx`
- Verify: `web/features/ai-generate/ai-generate-page.tsx`
- Verify: `web/features/ai-generate/ai-generate-runtime.ts`

- [ ] 运行 `bun test tests/unit/attachment-picker-preview.test.ts tests/unit/ai-generate-runtime.test.ts tests/unit/ai-generate-page.test.ts`。
- [ ] 运行 `bun run typecheck && bun run build`。
- [ ] 运行 `git diff --check && git diff --stat && git status --short`，确认没有触及 `.DS_Store` 或生成代码。
- [ ] 暂存设计与计划文档，并在预提交检查可通过时提交：`git add docs/plans/2026-07-28-ai-generate-reference-picker-design.md docs/superpowers/plans/2026-07-28-ai-generate-reference-picker.md && git commit -m "docs: plan AI reference media picker"`。
