# AI 创作真实生图模型设计

## 背景

AI 创作页面目前展示 8 个生图模型，但只有 GPT Image 1 Mini 走真实 AIHubMix 接口，其余条目被标记为
Mock。经 AIHubMix 官方模型目录和接口文档核对，`Seedream 5 Pro` 没有可调用的官方模型 ID；用户已确认
删除该条目，并要求其余生图模型全部接入真实 Provider。

## 模型目录

页面继续使用稳定的产品侧 ID，Provider 调用使用官方模型 ID。目录只展示能够真实调用的模型：

| 产品侧 ID | 展示名称 | Provider 模型 ID | 协议 |
| --- | --- | --- | --- |
| `seedream-5-lite` | 字节 Seedream 5.0 Lite | `doubao-seedream-5.0-lite` | AIHubMix Predictions |
| `seedream-4-5` | 字节 Seedream 4.5 | `doubao-seedream-4-5` | AIHubMix Predictions |
| `seedream-4-0` | 字节 Seedream 4.0 | `doubao-seedream-4-0` | AIHubMix Predictions |
| `nano-banana-2` | Nano Banana 2 | `gemini-3.1-flash-image` | Gemini Interactions |
| `nano-banana-pro` | Nano Banana Pro | `gemini-3-pro-image-preview` | Gemini Generate Content |
| `gpt-image-2-stable` | GPT Image 2.0 稳定版 | `gpt-image-2` | OpenAI Images Edit |
| `gpt-image-1-mini` | GPT Image 1 Mini | `gpt-image-1-mini` | OpenAI Images |

`seedream-5-pro` 从能力目录中删除，不做模型替换或静默降级。

## 架构

在服务端建立一个单一的真实生图模型目录，记录产品侧 ID、Provider 模型 ID、调用协议、尺寸、最大输出数和
参考图约束。能力接口、请求校验和 Worker 路由共同读取该目录，避免页面显示能力与 Provider 实际能力漂移。

AIHubMix Provider 提供三个聚合入口：

1. OpenAI Images：复用现有 JSON generation 和 multipart edit 请求。
2. AIHubMix Predictions：调用 `/v1/models/doubao/<model>/predictions`，支持 Seedream 文生图与带签名
   TOS URL 的单图或多图参考。
3. Gemini：使用 `@google/genai` 2.x 和 AIHubMix 的 `/gemini` 基地址。Nano Banana 2 使用 Interactions，
   Nano Banana Pro 使用非流式 Generate Content，并从 inline image part 提取 Base64。

Worker 不再假设所有图片模型都使用 OpenAI Images。它根据模型目录选择协议、转换尺寸、准备参考素材，并把
不同协议返回的 URL/Base64 统一为 `AihubmixImageResult`，之后沿用现有的下载、落盘、Artifact 和 lineage
流程。

## 数据流

1. 前端从 `/api/creation/capabilities` 获取已启用、`executionMode: "real"` 的模型能力。
2. `POST /api/ai-generate/jobs` 根据同一模型目录校验模型、画幅、分辨率、张数和参考图要求。
3. Worker 读取用户拥有的参考素材：
   - OpenAI/Gemini 使用内联字节；
   - Seedream 使用私有 TOS 对象的短期签名读 URL。
4. Provider 返回一个或多个 Base64/临时 URL，Worker 统一下载或解码并写入 `.data/results/`。
5. Worker 创建用户隔离的 Artifact，任务结果明确记录 `real`、实际 Provider 模型和调用实现。

## 能力与限制

- Seedream 4.5 只开放官方支持的 `2k`；Seedream 4.0 和 5.0 Lite 只声明文档可验证的尺寸。
- Nano Banana 2/Pro 只声明各自官方支持的画幅和分辨率；请求不支持的组合时在任务创建前返回结构化错误。
- GPT Image 2 官方只支持图片编辑，因此必须至少提供一张参考图；页面未提供参考图时不可提交该模型。
- GPT Image 1 Mini 保留文生图和参考图编辑能力。
- 不支持 `seed` 的模型不展示或提交种子值，不做参数丢弃式降级。
- 每次上游请求只使用用户选择的模型；失败时任务失败，不切换模型、不生成 Mock。

## 错误处理

Provider 错误继续经过 Worker 脱敏，屏蔽 URL 与密钥。参数或模型能力不匹配返回不可重试错误；上游限流、超时
和暂时性服务错误保持可重试。空响应、非图片响应、损坏 Base64 和结果下载失败都不得创建空 Artifact。

Seedream Predictions 和 Gemini 当前采用同步调用。若上游返回异步任务而非最终结果，Provider 明确报错，不
把未完成任务当作成功；后续只有在官方接口要求时才增加持久化轮询流程。

## 测试与验证

- 模型目录测试：证明 `seedream-5-pro` 已删除，其余 7 个模型均为真实、可用且映射到正确官方 ID。
- Provider 单元测试：分别断言 OpenAI、Seedream、Gemini 的请求路径、请求体、参考图和响应归一化。
- Worker 测试：覆盖每种协议的路由、参考素材处理、多结果落盘、真实 provenance、取消和错误脱敏。
- API/前端测试：覆盖能力列表、GPT Image 2 必须参考图以及不支持参数的提交拦截。
- 生成 OpenAPI/SDK 后运行相关测试、`make ci`、`bun run typecheck` 和 `bun run build`；不运行 E2E。

## 外部依据

- AIHubMix Image Generation API：
  <https://docs.aihubmix.com/en/api/Image-Gen>
- AIHubMix Gemini Guides：
  <https://docs.aihubmix.com/en/api/Gemini-Guides>
