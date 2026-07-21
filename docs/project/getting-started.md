# 本地开发与验证

> 最后更新：2026-07-21

## 准备

需要 Bun、可访问的 Redis（默认 `redis://127.0.0.1:6379`），以及按需安装的 Playwright、FFmpeg 和外部能力凭据。

```bash
cd /Users/aoer/Project/xbeaconai/xbeaconai-web
git status --short
bun --version
bun install
```

配置项以 `.env.example` 为准。不得提交或回显 `.env` 的密钥；生产环境必须配置至少 32 字符的 `JWT_SECRET`。

## 启动

```bash
make run-server
# 另开终端
make run-worker
```

也可运行 `make run-dev`。Web 为 `http://127.0.0.1:5173`，API 与 OpenAPI 为 `http://127.0.0.1:8787` 和 `/openapi.json`。Worker 必须独立运行才会消费任务。

生产先执行 `bun run build`，再分别启动 `bun run start` 和 `bun run worker`。Server 从 `dist/` 提供静态资源、API 与 SPA fallback。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `make lint` / `make test` / `make ci` | 格式/lint、单测、组合检查 |
| `bun run typecheck` / `build` / `e2e` | 类型、生产构建、端到端测试 |
| `bun run api:spec` / `api:generate` | 导出 OpenAPI / 生成 SDK |
| `bun run db:generate` / `db:check` / `db:migrate` | 生成、校验、执行 migration |

模型、TOS、FFmpeg、语音专项命令可能消耗配额或依赖本机环境，非普通改动的默认验证。

Playwright 覆盖 `1440x900` Desktop 与 `1024x768` Tablet。修改路由、任务状态、关键表单或共享布局时应运行相关 E2E；外部能力未运行时，交付中说明原因。

## 本地数据

- SQLite 默认在 `.data/yaozuo.sqlite`；用 `YAOZUO_DATA_DIR` 或 `YAOZUO_DATABASE_URL` 隔离数据。
- 上传暂存与本地结果为 `.data/uploads/`、`.data/results/`。
- Redis 队列默认 `yaozuo-jobs`，并发由 `WORKER_CONCURRENCY` 设置。
- 任务持续排队时优先检查 Redis 与 Worker；生产启动失败时检查 `JWT_SECRET`。
- Server 与 Worker 并发访问同一个 SQLite；测试应使用独立数据目录，不能复用生产数据库。
