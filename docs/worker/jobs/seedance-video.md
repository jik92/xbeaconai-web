# Seedance 共享视频流程

## 定位

`worker/jobs/job-seedance-video.ts` 提供 `SeedanceVideoJob` 和错误类型，供需要视频生成的专用 Handler 复用。它不是 `registry.ts` 中独立选择的 `WorkerJobHandler`。

## 统一职责

- 上游提交、轮询、取消核对、截止时间和结果获取。
- 私有 TOS 暂存对象的登记、终态清理和恢复处理。
- 上游任务 ID/状态及错误的 SQLite 回写，避免重启或超时后重复提交和重复计费。

## 维护规则

- 任何需要 Seedance 的 Job 都复用本流程，不复制 Provider 调用、轮询或清理代码。
- 模型必须由 Server 的已验证能力门禁选择；失败不能静默换模型、回退 Wan 或伪装成 Mock。
- 改动后检查取消、提交结果未知、Worker 恢复、暂存清理和真实/Mock 来源标记。

