# 素材理解设计

## 目标

为 AI 工具箱增加可真实执行的“素材理解”能力。用户选择一个主素材，并可补充商品参考图，通过火山方舟
Doubao Seed 多模态模型生成结构化 JSON 镜头脚本。典型用途是拆解现有带货视频，并将原商品替换为新商品，
例如把皮带带货视频改写为透明玻璃大茶缸带货脚本。

## 交互

页面复用 AI 创作使用的 `PromptWorkbench`、素材选择器、模型列表样式与任务结果交互。除提示词输入框和提交按钮外，
只提供三个配置入口：

1. 模型选择
2. 思考深度
3. 添加参考素材

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

模型能力通过服务端返回，某模型不支持当前主素材类型时禁用并显示原因。默认优先使用通过视频、音频和图片实测的
最新 Lite 模型。

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

使用官方 `@volcengine/ark-runtime` SDK 的 Responses API。媒体输入使用
`files.xbeaconai.com` 对应的 CDN URL，避免大文件经 API Server 中转或内联 Base64。

Worker 专用 Handler 按以下顺序执行：

1. 读取任务契约并重新校验素材所有权。
2. 根据存储 Key 生成 CDN 原始文件 URL。
3. 通过 Ark Responses API 提交文本、主素材及参考图。
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
- Ark 请求只接收 CDN URL，不把 TOS 密钥或签名凭据写入任务值、日志和 Artifact。
- 日志与错误信息不得包含完整媒体 URL。
- 取消请求在调用前和响应后检查；已取消任务不写成功结果。
- Ark Provider 错误保留可重试信息和 request ID，但不泄露上游响应中的敏感内容。

## 验证

- 请求 Schema、素材归属、数量、MIME 与幂等单元测试。
- Ark SDK 请求构造、思考深度映射和响应提取单元测试。
- Worker 成功、无效 JSON、无权素材、取消及 Provider 失败单元测试。
- 页面素材分组、模型选择、思考深度和提交载荷组件测试。
- 重新生成 OpenAPI 与前端 SDK。
- 执行相关单测、`make ci`、`bun run typecheck`、`bun run build`。
- 使用小型自有测试素材分别验证四个模型；记录每个模型对图片、视频和音频的真实结果，页面能力以实测为准。
