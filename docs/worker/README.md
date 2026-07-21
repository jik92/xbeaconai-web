# Worker 知识库

> 适用范围：`worker/`、`shared/jobs/` 及其与 `server/jobs/` 的协作。

本页是异步任务维护的二级入口。阅读本页后，只打开目标 Job 的文档，不需要加载所有 Handler。

## 职责和入口

- `worker/index.ts`：创建 Store/Redis/BullMQ Worker、启动维护、恢复可恢复任务、处理关闭。
- `worker/job-processor.ts`：读取 SQLite 中的任务、选择 Handler、提供状态回写上下文；不承载具体业务步骤。
- `worker/jobs/registry.ts`：按顺序注册 Handler。专用 Handler 在前，`generic-creation` fallback 必须最后。
- `worker/jobs/definitions/`：每个公开模块的阶段和输出定义；入口为 `definitions/index.ts`。
- `shared/jobs/queue-contract.ts`：Server 与 Worker 共用的最小消息契约；当前只传递 `jobId`。

## 维护流程

1. 确认任务所属模块、工作流阶段和现有 Handler；从 [Job 索引](jobs/README.md) 打开目标文档。
2. 优先修改该 `job-*.ts` 和对应 `definitions/<module>.ts`；只有跨 Job 复用时才抽取到 `utils.ts` 或专门共享流程。
3. 不在 Server、前端或 `JobProcessor` 复制 Job 业务。Server 只持久化并投递，Worker 执行并回写 SQLite。
4. 为新 Job 实现 `WorkerJobHandler`，将其注册在 fallback 前；新增公开模块时同步注册 Definition。
5. 验证幂等、取消、重试、恢复、对象清理、部分成功、执行来源和 owner 隔离。

## 必须保持的约束

- SQLite 是状态真相；队列消息、内存和日志不是业务状态存储。
- 阶段进度、终态、错误、结果、上游任务状态均需持久化回写。
- 外部能力的 `real`、`local`、`mock`、`mixed` 来源必须可追溯，禁止静默替换 Provider/模型/Mock。
- Seedance 的提交、轮询、取消核对和暂存清理复用 [共享 Seedance 流程](jobs/seedance-video.md)。

