# AI 创作专用接口设计

## 背景

`/tools/ai-generate` 已使用 assistant-ui，并能通过通用
`POST /api/{moduleId}/jobs` 创建任务。但现有实现仍把 AI 创作请求压成
`Record<string, string>`，由 `generic-creation` 兜底处理。图片参考素材只被
持久化，没有进入 AIHubMix 图片接口；图片与视频的校验、计费和错误语义也
散落在通用任务路由中。

本次目标是把 AI 创作变成一条独立、强类型、只调用真实 Provider 的生产链路。

## 范围

- 图片：AIHubMix `gpt-image-1-mini`，支持文生图与带参考图编辑。
- 视频：Ark Seedance，复用现有已验证的提交、轮询、取消、恢复与暂存清理能力。
- 交互：保留 assistant-ui 对话、`@素材` 引用、继续修改、重新生成和变体。
- 任务：继续使用统一 Job、BullMQ、SQLite、通知、鉴权素材 URL 和素材库落库。
- 不接入尚未验证的图片模型，不允许静默降级为 Mock。

## API 契约

新增专用 `POST /api/ai-generate/jobs`。请求体使用按 `kind` 区分的联合类型：

- 公共字段：`title`、`prompt`、`modelId`、`ratio`、`resolution`、
  `referenceAssetIds`、`parentJobId`、`revisionMode`。
- 图片字段：`kind: "image"`、`count`。
- 视频字段：`kind: "video"`、`duration`、`referenceMode`。

服务端不接受前端提交 owner ID、任意 Provider 名称、执行模式或价格。服务端根据
模型能力表规范化参数并计算创作点。所有引用素材必须属于当前用户，且 MIME 类型
必须在所选模型的允许集合内。

接口保持 `202 Job` 响应，以便继续复用任务轮询和 assistant-ui 的消息映射。幂等键
沿用 `Idempotency-Key`。

## Worker 架构

新增 `aiGenerateJob`，在 Registry 中排在 `generic-creation` 前：

1. 从持久化 Job 解析并再次校验规范化配置。
2. 图片任务解析用户素材并下载到隔离临时目录。
3. 无参考图时调用 AIHubMix images generations；有参考图时调用 images edits。
4. 视频任务调用现有 `SeedanceVideoJob`，保留远程素材暂存、Provider Task ID、
   进程恢复、取消核对和清理逻辑。
5. 生成文件写入 `.data/results/`，再使用现有 Artifact/素材库机制建立 owner 隔离记录。
6. Provider 失败直接写入结构化 Job error，不生成 Mock 结果。

专用 Handler 负责 AI 创作的状态与结果；`generic-creation` 不再处理
`ai-generate`。

## 图片 Provider

扩展 `AihubmixClient`：

- `generateImage(input)` 根据 `size`、`quality` 和输出数量构造 generations 请求。
- `editImage(input)` 使用 `FormData` 提交一张或多张参考图、prompt、model、size。
- 响应统一归一化为图片数组，支持 `b64_json` 和短期 URL。
- POST 请求不自动重试，避免付费请求重复提交。

首期只暴露能力表已验证的 `gpt-image-1-mini`。模型不支持的比例、分辨率、数量或
参考类型在 API 入队前返回 422。

## 迭代修改

`parentJobId` 仍要求指向同一用户、同模块且已成功的任务。继续修改和变体提交新
Job，不修改历史任务。前端显式提交本轮 `referenceAssetIds`；若修改图片且用户未
重新选择素材，允许把父任务生成的图片 Artifact 作为受控参考来源解析，形成真实
的图生图迭代，而不只是保存 lineage。

## 错误与安全

- 未验证 Provider：403 `PROVIDER_NOT_VERIFIED`。
- 配置不合法：422 `INVALID_AI_GENERATE_CONFIG`。
- 素材不存在或越权：422 `ASSET_NOT_AVAILABLE`。
- 素材 MIME 不支持：422 `UNSUPPORTED_REFERENCE_TYPE`。
- 父任务不合法：422 `INVALID_PARENT_JOB`。
- Provider 错误：Job 失败并记录安全化的 `PROVIDER_ERROR`；不回显密钥或签名 URL。
- 图片参考文件使用隔离临时目录，处理后无论成功失败均清理。

## 测试

- API：鉴权、联合类型、能力校验、所有权、MIME、父任务、计费、幂等和入队。
- Provider：generations JSON、edits multipart、响应归一化、无效响应。
- Worker：图片文生图、参考图编辑、视频委托、失败不降级、Artifact 落库和 Registry 顺序。
- 前端：专用 SDK 调用、`@素材` 到 `referenceAssetIds`、修改/变体父任务关系。
- 验证：相关 Bun 单测、OpenAPI/SDK 生成、`bun run typecheck`、`bun run build`。
  按仓库约束默认不运行 E2E，也不调用真实付费接口。
