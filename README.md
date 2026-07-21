# 烽火 AI 创作工作台

React Web、Hono API、SQLite、BullMQ/Redis 和独立 Worker 组成的本地优先 AI 创作应用。

> 本文件是项目知识库入口。开始任何开发任务时先读本页，再按任务类型进入 `docs/`；不要一次性读取全部文档。

## 按任务路由知识

| 你要做什么 | 先读 | 按需继续读 |
| --- | --- | --- |
| 了解项目或启动开发环境 | [docs/project/overview.md](docs/project/overview.md) | [本地开发](docs/project/getting-started.md)、[架构](docs/project/architecture.md) |
| 新增或改造功能 | [docs/features/README.md](docs/features/README.md) | [功能地图](docs/project/feature-map.md)、相关 `docs/plans/`、目标 Feature/Job 文档 |
| 改 API、数据、上传或鉴权 | [架构](docs/project/architecture.md) | 相关 Store/API 源码、功能文档 |
| 新增、维护或排查异步 Job | [Worker 索引](docs/worker/README.md) | [Job 索引](docs/worker/jobs/README.md) 中对应 Handler 文档 |
| 修复 Bug | [docs/bugs/README.md](docs/bugs/README.md) | 受影响功能、Worker/API 文档和已有 Bug 档案 |
| 音色克隆 | [音色克隆专题](docs/voice-clone-development.md) | [voice-clone Job](docs/worker/jobs/voice-clone.md) |
| 查阶段性设计或实施决策 | [docs/plans/](docs/plans/) | 与当前代码核对，长期事实以 `docs/project/` 为准 |

完整文档导航在 [docs/README.md](docs/README.md)。

## 最小启动与验证

```bash
bun install
make run-server
# 另开终端
make run-worker
```

也可使用 `make run-dev`。Web：`http://127.0.0.1:5173`；API/OpenAPI：`http://127.0.0.1:8787`、`/openapi.json`。

常用验证：`make ci`、`bun run typecheck`、`bun run build`、`bun run e2e`。配置项以 `.env.example` 为准；不要提交或回显密钥。

## 不可跨越的边界

- `web/` 只负责 UI 和 API SDK 调用；`server/` 只处理 HTTP、鉴权、持久化和任务投递；`worker/` 执行异步业务并回写 SQLite。
- 任务消息仅使用 `shared/jobs/queue-contract.ts`，持久化状态以 SQLite 为准；不要以进程内 Promise、Map 或 Server 后台任务替代 BullMQ。
- 每个专用 Job 都是 `worker/jobs/job-*.ts` 中的独立 Handler；其阶段/输出定义在 `worker/jobs/definitions/<module>.ts`。新增或修改 Job 必须更新对应的 Worker 文档。
- `web/api/generated/`、`openapi/openapi.json` 和 `drizzle/meta/` 是生成物，不能手改。

