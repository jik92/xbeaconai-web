# AI Creation Provider Doctor Gating Design

## Goal

AI 创作中的模型可用性只由密钥管理中对应 Provider 的 Doctor 结果决定，不再依赖会消耗模型额度的本地能力实测报告。

## Decisions

- 生图模型统一由 AIHubMix Doctor 控制。`aihubmix` 状态为 `available` 时，开放全部已注册真实生图模型。
- 生视频模型统一由 Ark Doctor 控制。`ark` 状态为 `available` 时，开放全部已注册 Seedance 模型。
- 两类 Provider 独立判断。AIHubMix 未通过不影响生视频，Ark 未通过不影响生图。
- 密钥新增、修改或删除后，沿用 `ProviderCredentialStore` 的现有检查失效机制；Doctor 重新通过前，对应模型保持禁用。
- Provider 请求失败时直接返回错误，不降级到 Mock 或其他模型。
- `.data/capabilities.json` 继续作为显式模型实测证据，但不再参与 AI 创作页面的启用判断。

## Data Flow

`GET /api/creation/capabilities` 从 `ProviderCredentialStore.isProviderVerified()` 读取持久化 Doctor 状态，将
`aihubmix` 状态传给生图能力，将 `ark` 状态传给生视频能力。创建任务和视频相关入口复用同一判断，避免页面显示可用但提交时被另一套门控拒绝。

## Testing

- 单元测试证明 AIHubMix 与 Ark 可以分别开启和关闭。
- API 隔离测试把 Doctor 结果写入临时数据库，验证能力接口返回对应的 `enabled` 状态。
- 搜索确认 AI 创作能力与提交路径不再读取 `.data/capabilities.json`。
- 运行相关单测、类型检查和生产构建；默认不运行 E2E。
