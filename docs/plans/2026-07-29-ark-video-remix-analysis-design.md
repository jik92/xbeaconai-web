# Ark 视频理解替换二创解析设计

## 目标

将爆款二创的 AI 解析从 AIHubMix Gemini 切换至火山 Ark 视频理解模型，消除对失效 AIHubMix 凭据的依赖。

## 方案

- 新增独立 Ark 多模态理解客户端，使用既有 `ARK_API_KEY` 与 Ark Chat Completions 协议；不复用 Seedance 视频生成任务接口。
- Worker 保持原有素材下载、视频探测、商品图规范化、提示词、结果与分镜流程，只替换模型提交和响应文本提取。
- 模型通过单独配置项提供默认值，并在提交前确认该模型在当前 Ark 账号可用。
- 解析阶段溯源改为 `provider: "ark"` 和 Ark 模型名；非 2xx 响应保留已脱敏的状态、请求 ID 和响应摘要。
- AIHubMix 继续服务于其余文本、图像与音频功能，不作为视频二创解析的回退 Provider。

## 验收

- 视频二创解析不再发起 `aihubmix` / Gemini 请求。
- Ark 成功响应可写入原有 `analysisEntries` 与 Markdown 产物。
- Ark 鉴权或模型权限失败时，用户能看到明确的 Ark 错误。
- 单测、类型检查、构建通过；仅在凭据有效时运行一次真实 Ark 连通性验证。
