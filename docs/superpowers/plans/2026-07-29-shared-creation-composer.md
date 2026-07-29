# Shared Assistant Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让路由中的 AI 创作与素材理解使用同一个 assistant-ui 聊天线程和 Composer，仅由业务 Controller 注入不同参数与提交内核。

**Architecture:** 从实际在线的 `AiGeneratePage` 提取 `CreationAssistantComposer`、`CreationAssistantThread` 和共享参考素材预览。
AI 创作保留现有 external-store runtime、产品对话和生成参数；素材理解建立自己的 external-store runtime，把
`media-understand` Job 映射为同样的用户/助手消息，并继续调用专用 Ark API。

**Tech Stack:** React 19、assistant-ui、TanStack Query、TypeScript strict、Bun Test、Tailwind CSS

## Global Constraints

- 共享基准是路由实际使用的 `web/features/ai-generate/ai-generate-page.tsx`，不是旧 `AiCreationComposer`。
- 两页必须渲染同一个 `CreationAssistantComposer` 和 `CreationAssistantThread`，不能复制 JSX 或 CSS 模拟。
- 素材理解仅显示模型选择、思考深度和添加参考素材。
- 素材理解继续调用 `submitMediaUnderstandJob`，不得改用 AI 创作提交接口。
- 添加参考素材必须使用同一个 `AttachmentPicker` 按钮、素材预览、移除交互和 assistant-ui attachment 状态。
- AI 创作现有简洁/专业模式、参数、产品对话、继续修改和创建变体行为保持不变。
- 不新增第三方依赖，不运行 E2E。

---

### Task 1: 提取真实共享 assistant-ui Composer

**Files:**
- Create: `web/components/domain/creation-assistant-composer.tsx`
- Modify: `web/features/ai-generate/ai-generate-reference-preview.tsx`
- Test: `tests/unit/creation-assistant-composer.test.tsx`

**Interfaces:**
- Consumes: `ComposerPrimitive`, `AttachmentPicker`, `Button`, standardized reference items and business control slots.
- Produces: `CreationAssistantReference`, `CreationAssistantComposer`, `CreationAssistantThread`.

- [ ] **Step 1: Write the failing structural test**

Assert that `CreationAssistantComposer` renders `data-creation-assistant-composer="true"`, the shared rounded input card,
the standardized reference preview, “添加参考素材”, business controls and shared send button.

- [ ] **Step 2: Run the test and verify RED**

Run: `bun test tests/unit/creation-assistant-composer.test.tsx`

Expected: FAIL because `creation-assistant-composer.tsx` does not exist.

- [ ] **Step 3: Implement the shared components**

`CreationAssistantComposer` owns `ComposerPrimitive.Root`, default `ComposerPrimitive.Input`, reference preview,
`AttachmentPicker`, bottom control row and `ComposerPrimitive.Send`. It accepts typed props for references, attachment
rules, business controls, optional header/input content and send state. `CreationAssistantThread` owns the shared
viewport, empty state, scroll-to-bottom button and sticky Composer footer.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `bun test tests/unit/creation-assistant-composer.test.tsx`

Expected: PASS.

### Task 2: 让在线 AI 创作消费共享组件

**Files:**
- Modify: `web/features/ai-generate/ai-generate-page.tsx`
- Modify: `tests/unit/ai-generate-page.test.ts`

**Interfaces:**
- Consumes: `CreationAssistantComposer`, `CreationAssistantThread`.
- Produces: unchanged `AiGeneratePage` behavior with shared component markers.

- [ ] **Step 1: Add failing regression assertions**

Require `AiGeneratePage` source to import and render both shared components while retaining concise/professional modes,
model-aware references, product conversations, reload and variant behavior.

- [ ] **Step 2: Run and verify RED**

Run: `bun test tests/unit/ai-generate-page.test.ts`

Expected: FAIL because the live page still owns duplicated Composer/Thread markup.

- [ ] **Step 3: Refactor the live AI composer**

Keep business state and assistant-ui runtime in `AiGeneratePage`; pass the existing mention popover, professional form,
generation controls, reference rules and send state into `CreationAssistantComposer`. Replace the local thread frame
with `CreationAssistantThread`.

- [ ] **Step 4: Run and verify GREEN**

Run: `bun test tests/unit/ai-generate-page.test.ts tests/unit/creation-assistant-composer.test.tsx`

Expected: PASS.

### Task 3: 将素材理解迁移到同一聊天线程

**Files:**
- Modify: `web/features/media-understand/media-understand-runtime.ts`
- Replace: `web/features/media-understand/media-understand-page.tsx`
- Modify: `tests/unit/media-understand-page.test.ts`
- Delete: `tests/unit/creation-composer-modes.test.tsx`
- Delete: `tests/unit/creation-composer-shell.test.tsx`

**Interfaces:**
- Consumes: shared assistant Composer/Thread and dedicated media-understand API.
- Produces: `mediaUnderstandJobsToThreadMessages(jobs)`, assistant-ui runtime and shared material-understanding composer.

- [ ] **Step 1: Add failing behavior tests**

Test stable user/assistant message mapping for `media-understand` jobs. Require the page to import/render the same shared
Composer and Thread, expose only “素材理解模型”, “思考深度” and “添加参考素材”, and retain `submitMediaUnderstandJob`.

- [ ] **Step 2: Run and verify RED**

Run: `bun test tests/unit/media-understand-page.test.ts`

Expected: FAIL because the page still uses the obsolete large `CreationComposerShell`.

- [ ] **Step 3: Implement the media assistant runtime**

Map each Job to a user prompt message and an assistant data message containing status, progress, error and JSON artifact.
Use `useExternalStoreRuntime`; on send, read assistant-ui attachments, classify one primary plus at most five image
references, build the dedicated request and invalidate `["api-tasks", "media-understand"]`.

- [ ] **Step 4: Render the shared Composer and Thread**

Use the shared default input and reference preview. Pass only model and reasoning selects as business controls. Configure
the shared attachment picker for `image/*,video/*,audio/*`; keep the same shared send button and sticky footer.

- [ ] **Step 5: Run and verify GREEN**

Run:
`bun test tests/unit/media-understand-page.test.ts tests/unit/creation-assistant-composer.test.tsx tests/unit/ai-generate-page.test.ts`

Expected: PASS.

### Task 4: Remove the wrong legacy sharing path and verify delivery

**Files:**
- Delete: `web/components/domain/creation-composer-shell.tsx`
- Delete: `web/components/domain/creation-composer-shell.css`
- Revert or remove unused changes in: `web/features/ai-creation/ai-creation-composer.tsx`
- Delete: `web/features/media-understand/media-understand-page.css`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: one active shared assistant Composer implementation with no routed dependency on the obsolete shell.

- [ ] **Step 1: Verify no routed feature imports the obsolete shell**

Run: `rg -n "creation-composer-shell|AiCreationComposer" web/app web/features`

Expected: no routed page imports.

- [ ] **Step 2: Run focused and full verification**

Run:

```bash
bun test tests/unit/creation-assistant-composer.test.tsx tests/unit/ai-generate-page.test.ts tests/unit/media-understand-page.test.ts
bun run typecheck
bun run build
git diff --check
```

Expected: all commands exit 0. Run `make ci` and report any unrelated pre-existing repository formatting failure separately.
