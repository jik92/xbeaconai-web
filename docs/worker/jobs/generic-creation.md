# 通用创作 Job

## 定位

`worker/jobs/job-generic-creation.ts` 是最后注册的 fallback。只有未被专用 Handler 支持的公开模块才会进入它；它读取 `jobDefinitions` 构建执行计划并产出通用结果。

## 维护边界

- 模块阶段、输出类型和摘要一律在 `worker/jobs/definitions/<module>.ts` 声明，并通过 `definitions/index.ts` 注册；不要把模块差异散落到 fallback。
- 新增专用 Job 时，先添加专用 Handler 并放在 `registry.ts` 的 fallback 前，避免通用流程抢占。
- `buildExecutionPlan` 和 `stageMap` 是任务来源、进度和结果一致性的共享基础；修改需要回归所有使用该 Definition 的模块。

当前通用 Definition 包含 AI 创作、素材理解、视频修复、爆款裂变等尚未被专用 Handler 接管的模块；实际开放状态以 `web/app/config.ts` 为准。视频混剪已由 `job-video-mashup.ts` 接管。
