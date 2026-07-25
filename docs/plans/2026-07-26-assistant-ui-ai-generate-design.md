# assistant-ui AI 生成工作台设计

## 目标

把 `/tools/ai-generate` 从浏览器 Mock 页面改造成基于 assistant-ui 的真实创作对话：

- 支持真实图片与视频任务；
- 支持围绕已有结果反复修改、重新生成和创建变体；
- 支持在提示词中使用 `@图片1`、`@视频1`、`@音频1` 等素材引用；
- 删除 `ai-generate.css`，优先复用 assistant-ui primitives、项目已有 shadcn 组件和 Tailwind Token；
- Provider 不可用或任务失败时明确展示真实状态，不静默回退 Mock。

## 方案比较

### 方案 A：LocalRuntime 管理全部对话状态

用 `useLocalRuntime` 直接驱动生成 API。实现较快，并天然支持编辑、重生成和分支，但本项目任务与会话的权威状态已经在 TanStack Query、SQLite 和 Job API 中，页面刷新后的任务恢复与多会话映射会出现双重状态源。

### 方案 B：ExternalStoreRuntime 映射现有 Job（采用）

SQLite Job 和 Query 缓存继续作为权威数据源；页面把任务映射为 assistant-ui 消息，通过 `useExternalStoreRuntime` 提供 `onNew`、`onEdit` 和 `onReload`。生成状态、失败原因和结果附件都直接来自 Job。该方案样板代码略多，但能保持 Server/Worker 状态一致，并适合现有独立进程架构。

### 方案 C：只使用 assistant-ui 的视觉组件

保留当前 Mock Store，仅用 primitives 重画页面。改动最小，但不满足真实 Server/Worker 生成要求，因此不采用。

## 架构

前端使用 `@assistant-ui/react` 的 `AssistantRuntimeProvider`、`ThreadPrimitive`、`MessagePrimitive`、`ComposerPrimitive`、`AttachmentPrimitive` 和 `ActionBarPrimitive`。不复制官方完整 Thread 模板，而是组合 primitives，并通过项目现有 `Button`、`Popover`、`Dialog`、`NativeSelect`、`AttachmentPicker` 与 `MediaPreview` 保持现有设计语言。

`useAiGenerateRuntime` 负责三件事：

1. 把 `fetchJobs("ai-generate")` 返回的 Job 转换为有稳定 ID 的用户/助手消息对；
2. 把 composer 提交、用户消息编辑和助手消息重生成转换成 `submitJob` 请求；
3. 维护当前创作参数与被引用素材，任务数据本身不复制到本地 Store。

API 沿用通用 `POST /api/{moduleId}/jobs`，但为 `ai-generate` 增加严格值解析与上下文字段：

- `creationKind`: `image | video`
- `prompt`: 当前轮修改指令
- `modelId`、`ratio`、`resolution`、`count`、`duration`、`seed`、`referenceMode`
- `references`: 结构化素材引用
- `parentJobId`: 可选，指向被继续修改或创建变体的任务
- `revisionMode`: `new | edit | variant`

Server 根据 owner 校验 `parentJobId`，拒绝跨用户引用，并把父任务已生成的可用产物合并为本轮参考素材。BullMQ 消息仍保持最小化，只携带 Job ID；Worker 从 SQLite 读取完整状态。

## 对话与连续修改

每个 Job 映射为一条用户消息和一条助手消息：

- 用户消息展示本轮提示词及素材附件；
- 助手消息在 queued/running 状态展示进度，在 completed 状态展示图片或视频产物，在 failed 状态展示结构化错误；
- “修改”编辑对应的用户消息，并创建一个带 `parentJobId` 的新任务，不覆写历史；
- “重新生成”复用同一提示词和引用，创建 `revisionMode=edit` 的新任务；
- “创建变体”将当前结果作为参考，创建 `revisionMode=variant` 的新任务；
- 下载直接使用鉴权下载方法，不再生成 Mock JSON。

历史任务按创建时间显示。第一阶段使用单个持久任务流，不额外新增会话表；这样页面刷新可恢复完整生成历史，同时避免把只存在于浏览器的“对话”伪装成持久会话。新对话只清空当前 composer 上下文，不删除历史任务。

## `@` 素材引用

素材通过两条路径进入 composer：

- `ComposerPrimitive.AddAttachment` 选择本地文件并走现有安全直传流程；
- 素材按钮打开现有 `AttachmentPicker`，选择素材库中的图片、视频或音频。

每个附件获得稳定标签，如 `图片1`。输入 `@` 时显示当前附件的 mention 列表；选择后插入 `@图片1`。提交前解析所有 mention：

- 未解析标签阻止提交并显示具体错误；
- 请求只发送实际被 mention 的附件；没有 mention 时发送 composer 中的全部附件，兼容自然输入；
- 视频模型继续遵守 Provider 对图片、视频、音频数量和来源的限制；
- 消息渲染同时显示 mention 文本与附件缩略图。

## 样式

删除 `web/features/ai-generate/ai-generate.css` 及 `PromptWorkbench` 对它的导入。新页面不新增业务 CSS 文件，使用 Tailwind 类和现有设计 Token：

- 白色全高工作区、hairline 分隔；
- 左侧紧凑历史区，右侧 Thread；
- CTA 使用现有 pill Button；
- 输入、选择器、弹层和对话框复用项目 UI 组件；
- 1440×900 为主布局，1024×768 时历史栏收窄或折叠；
- 不增加标题下的说明性文案。

## 错误与真实能力

能力列表来自 `/api/creation/capabilities`。未验证 Provider 的模型保持可见但禁用，并展示服务端原因。任务提交、上传、轮询和下载错误进入消息错误区或 composer 校验区。请求设置 `allowMockFallback: false`，结果明确标识 `real`、`local`、`mock` 或 `mixed` 来源。

## 测试

- 纯函数单测：Job 到 assistant-ui 消息映射、mention 解析、连续修改请求构造；
- API 单测：父任务 owner 隔离、非法父任务、结构化引用校验；
- Worker 单测：图片与视频路由、父产物合并、无 Mock 回退；
- React 单测：Thread primitives、类型切换、`@` 引用、提交和结果操作；
- 默认不运行 E2E；运行相关 Bun 单测、`make ci`、`bun run typecheck` 和 `bun run build`。

