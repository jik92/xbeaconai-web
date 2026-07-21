# 架构说明

> 最后更新：2026-07-21

## 三进程边界

```text
浏览器 → web/（React + 生成 SDK） → server/（Hono、JWT、Drizzle/SQLite）
                                         → Redis/BullMQ（仅投递与管理）
worker/（BullMQ 消费者） ← Redis/BullMQ  ↔ 同一个 SQLite
worker/ → FFmpeg、模型/语音 Provider、TOS
```

Server 不执行异步业务，Worker 不承载 HTTP API。跨进程消息使用 `shared/jobs/queue-contract.ts`；SQLite 是业务状态真相。

## 前端与 API

- 入口为 `web/main.tsx`，路由为 `web/app/router.tsx`，模块配置与开放开关在 `web/app/routes.ts`、`web/app/config.ts`。
- 业务页在 `web/features/`，通用组件在 `web/components/`；前端使用 `web/api/generated/`，不复制 DTO 或手写重复请求。
- API 在 `server/app.ts` 以 Zod/OpenAPI 定义。修改对外契约后运行 `api:spec`、`api:generate`、`typecheck`。
- `/api/*` 默认 Bearer JWT 鉴权；Server 从身份上下文取得 owner，并实施 CORS、Origin 校验与安全响应头。

## 数据与异步任务

- `server/db/schema.ts` 维护 Schema，`drizzle/` 维护 migration；连接使用 WAL、busy timeout 和 foreign keys。
- 任务先写 SQLite，再由 `server/jobs/bull-job-queue.ts` 以任务 ID 投递，可使用 `Idempotency-Key` 去重。
- Worker 启动时恢复可恢复任务和对象清理；`worker/jobs/registry.ts` 的专用 Handler 必须排在通用 fallback 前。Job 维护入口见 [Worker 索引](../worker/README.md)。
- Handler 采用一 Job 一文件：`worker/jobs/job-*.ts` 只实现本领域执行；公共阶段定义放 `worker/jobs/definitions/<module>.ts`，注册集中于 `definitions/index.ts` 和 `registry.ts`。共享上游 Seedance 流程不复制到各 Handler。
- 状态为 `queued`、`processing`、`succeeded`、`partially_succeeded`、`failed`、`cancelled`；页面通过查询和 SSE 获取更新。
- 每次进度、结果、取消/重试/恢复与执行来源都必须回写 SQLite。

## 部署

开发由 Vite 与 API 分别提供服务。生产 `server/index.ts` 从 `dist/` 提供静态文件与 SPA fallback；API、Worker、Redis、SQLite 数据目录和所需凭据必须同时部署。
