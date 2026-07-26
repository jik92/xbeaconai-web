# AI 创作视频模型仅真实执行设计

## 目标

AI 创作的生视频模型只允许通过 Ark Seedance 真实 Provider 执行。运行时不得因为
`YAOZUO_MOCK_GENERATE_VIDEO_API` 或其他环境配置切换为 Mock，也不得在页面展示 Mock 模型或生成本地假视频。

## 设计

- `/api/creation/capabilities` 中的 Seedance 模型固定发布 `executionMode: "real"`。
- 模型是否可用只取决于对应 Ark SDK 基线是否已验证；未验证时模型禁用并说明真实 Provider 尚未验证。
- AI 创作专用 Worker 始终委托 `SeedanceVideoJob` 的真实 Ark 流程。
- `SeedanceVideoJob` 删除环境变量控制的 FFmpeg Mock 分支；上游不可用时明确失败，不生成替代视频。
- 单元测试通过依赖注入的 Seedance executor 验证 Worker 行为，不依赖生产运行时 Mock 开关。
- 与 AI 创作无关的独立 FFmpeg 测试工具可以继续存在，但不能成为生产 Seedance 请求的执行路径。

## 错误与验证

Ark 未配置、模型未验证、提交失败、轮询失败或下载失败均保持结构化真实 Provider 错误。任务结果和
provenance 必须为 `real`，实现标识必须为 `ark-seedance-video`。

测试证明：

1. 即使设置旧 Mock 环境变量，能力接口仍只发布真实 Seedance。
2. Worker 不存在基于该环境变量生成本地 Seedance 视频的分支。
3. 所有 AI 创作图片和视频模型均不发布 `executionMode: "mock"`。
4. 相关单测、类型检查和生产构建通过；E2E 不运行。
