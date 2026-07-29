# 素材理解设计

## 目标

为 AI 工具箱增加可真实执行的“素材理解”能力。用户选择一个主素材，并可补充商品参考图，通过火山方舟
Doubao Seed 多模态模型生成结构化 JSON 镜头脚本。典型用途是拆解现有带货视频，并将原商品替换为新商品，
例如把皮带带货视频改写为透明玻璃大茶缸带货脚本。

## 交互

页面不再维护一套“类似 AI 创作”的独立结构。路由中的 AI 创作实际由
`web/features/ai-generate/ai-generate-page.tsx` 的 assistant-ui Thread 与 Composer 提供，因此共享对象必须是这套
当前在线组件，而不是已经退出路由的旧 `AiCreationComposer`。

AI 创作与素材理解必须使用同一个共享 assistant-ui Composer：相同的圆角输入卡片、输入高度、参考素材预览、
素材库/本地上传入口、发送按钮、键盘提交、禁用状态和焦点行为。两页也使用同一个 Thread 布局，消息区独立滚动，
Composer 固定在底部。两个业务 Controller 只注入标题、可见参数、素材规则、提交函数和结果消息，确保后续 UI 与
交互修改不会再次分叉。

AI 创作保留现有图片/视频类型、参考模式、尺寸、数量、种子和手动确认逻辑；素材理解只显示：

1. 模型选择
2. 思考深度
3. 添加参考素材

“添加参考素材”使用 AI 创作当前 Composer 底部的同一个按钮与 `AttachmentPicker`，而不是自定义左侧虚线卡片
或独立弹层。素材理解不显示简洁版/专业版、创作类型、画幅、清晰度、生成数量、时长、种子、参考模式、手动确认
和星点报价控件。页面标题仍为“素材理解”，输入提示与结果内容使用素材理解业务文案。

素材选择规则：

- 必须且只能有一个主素材，类型为图片、视频或音频。
- 可附加最多五张商品参考图。
- 第一份非图片素材自动作为主素材；只有图片时，第一张图片作为主素材。
- 页面清楚标记“主素材”和“商品参考图”，允许移除后重新选择。

模型列表固定为当前 Ark 账号可见的四个版本：

- `doubao-seed-2-0-pro-260215`
- `doubao-seed-2-1-pro-260628`
- `doubao-seed-2-0-lite-260428`
- `doubao-seed-2-0-mini-260428`

模型能力通过服务端返回，某模型不支持当前主素材类型时禁用并显示原因。2026-07-29 的真实 Ark 基线结果为：

- 2.0 Pro：图片、视频通过；纯音频被 Ark 拒绝为不支持的 content type。
- 2.1 Pro：图片、视频通过；纯音频被 Ark 拒绝为不支持的 content type。
- 2.0 Lite：图片、视频、纯音频全部通过。
- 2.0 Mini：图片、视频、纯音频全部通过。

因此默认使用通过三种素材类型实测的最新 Lite 模型；音频主素材下禁用两个 Pro 模型。

思考深度提供“关闭、标准、深入”三档，并映射为 Ark Responses API 支持的思考配置。

## API 与任务契约

新增专用接口 `POST /api/media-understand/jobs`，不再把素材信息编码进通用 `values.source` 字符串。
请求包含：

- `modelId`
- `reasoningEffort`
- `prompt`
- `primaryAssetId`
- `referenceImageAssetIds`
- `idempotencyKey`

服务端负责：

- Bearer Token 鉴权。
- 校验主素材和参考图均属于当前用户。
- 校验主素材 MIME、参考图 MIME、数量和重复项。
- 校验模型 ID 与当前能力。
- 创建 `media-understand` BullMQ 任务并按现有计费/幂等规则入库。

任务结果保存为 `application/json` 文本 Artifact，并继续通过现有任务查询接口返回。

## Ark 调用

使用官方 `@volcengine/ark-runtime` SDK 的 Responses API。用户页面继续使用
`files.xbeaconai.com` CDN URL；Worker 从私有 TOS 将所属素材下载到任务临时目录，再通过 SDK 的 Files API
显式上传并把 `file_id` 交给 Responses API。不能把 CDN URL 直接交给 Ark：生产 CDN 的 Referer 防盗链会拒绝
Ark 的无 Referer 拉取，实测返回 HTTP 403。也不使用 SDK 1.0.10 的 `file://` 自动上传路径：它在当前 Bun
运行时会把流错误序列化，真实调用返回 `Failed to get file`。显式传入 `File` 已避开该兼容问题。

Worker 专用 Handler 按以下顺序执行：

1. 读取任务契约并重新校验素材所有权。
2. 根据存储 Key 从私有 TOS 下载到 Worker 临时目录。
3. 通过 Ark SDK Files API 上传并使用 `file_id` 调用 Responses API，提交文本、主素材及参考图。
4. 强制模型仅返回 JSON。
5. 提取响应文本，剥离可能的 Markdown 代码围栏并执行 JSON 解析。
6. 用 Zod 校验镜头脚本结构；结构不合格时执行一次 JSON 修复请求。
7. 保存格式化后的 JSON Artifact、模型、Provider、耗时和任务 provenance。

Ark 不可用、素材不可访问或模型返回无效结构时任务明确失败，不允许切换 Mock 或其他 Provider。

## 输出结构

顶层 JSON 包含：

- `title`
- `source_summary`
- `replacement_brief`
- `global_settings`
- `shots`

每个镜头包含：

- `shot_number`
- `start_seconds`
- `end_seconds`
- `duration_seconds`
- `visual`
- `original_dialogue`
- `rewritten_dialogue`
- `action`
- `shot_type`
- `camera_movement`
- `transition`
- `product_replacement`
- `audio`

视频要求镜头连续覆盖素材时间轴，起止时间单调递增；图片和音频仍返回同一结构，但允许单镜头和缺少视觉或原对白。
系统提示词明确要求不得虚构不可见事实，商品参考图只用于替换目标商品，不得错误沿用原商品品牌、材质或卖点。

## 安全与失败处理

- Worker 始终从数据库重新读取归属关系，不信任前端提交的 URL、owner ID 或存储 Key。
- Ark 请求只接收任务临时文件 URL，不把 TOS 密钥、签名凭据或内部存储地址写入任务值、日志和 Artifact。
- 无论成功、失败或取消，Worker 都必须清理任务临时目录。
- 日志与错误信息不得包含完整媒体 URL。
- 取消请求在调用前和响应后检查；已取消任务不写成功结果。
- Ark Provider 错误保留可重试信息和 request ID，但不泄露上游响应中的敏感内容。

## 验证

- 共享 assistant-ui Composer 的 AI 创作模式回归测试，证明现有生成参数、提交和任务交互未被改变。
- 共享 assistant-ui Composer 的素材理解模式测试，证明两页渲染同一组件标记、同一附件入口与底部发送交互，
  同时素材理解仅显示模型、思考深度和附件入口。
- 请求 Schema、素材归属、数量、MIME 与幂等单元测试。
- Ark SDK 请求构造、思考深度映射和响应提取单元测试。
- Worker 成功、无效 JSON、无权素材、取消及 Provider 失败单元测试。
- 页面素材分组、模型选择、思考深度和提交载荷组件测试。
- 重新生成 OpenAPI 与前端 SDK。
- 执行相关单测、`make ci`、`bun run typecheck`、`bun run build`。
- 使用小型自有测试素材分别验证四个模型；记录每个模型对图片、视频和音频的真实结果，页面能力以实测为准。
