# 第三方素材生成审计日志设计

## 目标

在系统管理中增加只读的“审计日志”，让管理员追踪所有调用第三方服务生成或处理素材的任务，并查看：

- 发起请求的用户信息；
- 业务模块、Provider、模型或接口；
- 原始提交参数和提交时间；
- 第三方任务标识、状态、完成时间和耗时；
- 最终返回结果、结构化错误以及生成素材。

列表必须复用 `web/components/ui/data-table.tsx`，保持现有系统管理页面的紧凑布局。

## 方案选择

采用“任务级聚合审计”，而不是把每次 HTTP 提交或轮询拆成独立日志。同一次生成任务从提交、处理中到成功或失败持续更新一条记录。这样既保留第三方调用的完整生命周期，也不会因轮询产生大量无法阅读的重复行。

审计范围是产生或处理用户素材的真实第三方请求。Provider 密钥检测、签名 URL 下载和普通文件抓取等辅助调用不进入审计日志；本地 Mock 不伪装为第三方请求。

## 数据模型

新增 `provider_generation_audits` 表，核心字段为：

- `id`：审计记录 UUID；
- `job_id`：本地异步任务 ID，可用于幂等聚合同一任务；
- `owner_user_id`：发起用户；
- `module_id`、`capability`：业务模块和生成阶段；
- `provider`、`model`、`operation`：第三方服务与接口标识；
- `provider_task_id`、`provider_request_id`：第三方返回的任务和请求标识；
- `status`：`submitting`、`processing`、`succeeded`、`failed`、`cancelled`；
- `request_payload`：脱敏后的原始提交参数 JSON；
- `response_payload`：脱敏后的最终响应 JSON；
- `error_payload`：结构化错误 JSON；
- `asset_ids`：生成或处理结果对应的素材 ID JSON；
- `submitted_at`、`completed_at`、`duration_ms`、`created_at`、`updated_at`。

`job_id + capability + operation` 建立唯一索引，重试和 Worker 恢复继续更新原记录。用户删除后审计记录仍保留用户 ID；列表通过左连接补充当前手机号和昵称。

## 安全与数据治理

写入前递归处理请求与响应，字段名命中 `authorization`、`token`、`secret`、`password`、`apiKey`、`accessKey`、`signature`、`credential`、`cookie` 时统一保存为 `[REDACTED]`。URL 查询参数中的同类字段也脱敏。

审计 API 仅允许现有管理员身份访问。接口只提供分页列表和单条详情，不提供修改或删除。列表返回摘要，完整参数和响应只在详情接口返回，避免 DataTable 查询传输大 JSON。

## 服务端与 Worker 数据流

新增独立 `ProviderGenerationAuditStore`，与现有 SQLite 数据库连接共享生命周期。Worker 上下文暴露以下三个明确动作：

1. 第三方提交前 `begin`，写入用户、任务、Provider 和原始参数；
2. 获取第三方任务 ID 或轮询状态时 `progress`，更新标识和状态；
3. 成功、失败或取消时 `complete`，写入结果、错误、素材 ID 和耗时。

所有当前真实的第三方素材生成/处理入口接入这一契约，包括 AIHubMix 文本、图片、视频，多模态生成，火山语音/音色，阿里 Qwen 音频，以及 MediaKit 视频处理。聚合逻辑放在 Store，业务 Job 只提供领域数据，避免在 Provider 客户端中依赖用户或 Job 上下文。

## 管理 API

新增：

- `GET /api/admin/provider-audits`：分页列表，支持 `search`、`provider`、`moduleId`、`status`、`startedFrom`、`startedTo`；
- `GET /api/admin/provider-audits/{auditId}`：单条完整详情。

列表项包含用户手机号/昵称、任务和第三方标识、状态、提交/完成时间、耗时、结果素材数量。详情额外返回解析后的请求、响应、错误以及可预览素材的鉴权 URL 和 MIME 类型。

API 契约使用 `@hono/zod-openapi`，随后生成 OpenAPI 文档与前端 SDK；前端通过 `web/api/api-client.ts` 的领域封装调用生成 SDK。

## 管理端交互

系统管理增加“审计日志”页签。工具栏提供搜索、Provider、模块、状态、起止时间和刷新；表格使用共享 `DataTable`，列为提交时间、用户、模块、Provider/模型、第三方任务、状态、耗时、结果和操作。

点击“查看”打开共享紧凑 Dialog。Dialog 只保留“审计详情”主标题，分区显示用户信息、时间线、原始提交参数、第三方响应或错误，以及生成素材。JSON 使用可换行的等宽只读区域；图片、音频、视频复用统一媒体预览组件，确保完整显示且可播放。

## 错误处理

- `begin` 写入失败时不阻断用户的生成任务，但记录结构化服务器日志；
- 后续更新未找到记录时允许补建，覆盖 Worker 恢复或历史中断场景；
- JSON 序列化失败时保存可读的类型摘要，不写入凭据；
- 管理列表加载失败沿用现有管理页错误态，详情失败使用 toast；
- 素材已删除或签名失败时仍展示素材 ID，并标记预览不可用。

## 测试与验证

- Store 单元测试：创建、幂等更新、完成耗时、筛选分页、用户关联、递归脱敏；
- Worker/Job 测试：真实 Provider 路径写入提交和最终结果，失败路径保存错误，Mock 路径不写审计；
- API 契约与鉴权测试：仅管理员访问，列表过滤，详情返回参数和素材；
- 前端源码/组件测试：存在审计页签、复用 `DataTable`、筛选参数和详情媒体预览；
- 生成 migration、OpenAPI 和 SDK；
- 运行相关单测、`make ci`、`bun run typecheck`、`bun run build`，不自行运行 E2E。
