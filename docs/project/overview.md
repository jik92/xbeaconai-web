# 项目概览

> 最后更新：2026-07-21

`xbeaconai-web` 是烽火 AI 的本地优先创作工作台。当前代码由 React Web、Hono API Server 和 BullMQ Worker 三个 TypeScript 进程组成；SQLite 保存业务状态，Redis 队列执行长耗时任务。

## 技术栈

| 类别 | 技术 | 用途 |
| --- | --- | --- |
| 运行时 | Bun | 安装、构建、测试和运行 |
| 前端 | React 19、Vite、TanStack、Tailwind | 页面、路由、数据与 UI |
| API | Hono、Zod、`@hono/zod-openapi` | HTTP API、鉴权、OpenAPI |
| SDK | `@hey-api/openapi-ts` | 生成前端 TypeScript/Zod/Query SDK |
| 数据与任务 | Drizzle、SQLite、BullMQ、Redis | 持久化、异步任务和恢复 |
| 外部能力 | TOS、FFmpeg、模型/语音 Provider | 私有素材、媒体与 AI 能力 |
| 质量 | Biome、TypeScript strict、Bun Test、Playwright | 静态检查、单测、E2E |

## 源码布局

```text
web/       React 前端：页面、组件、样式、生成 SDK
server/    Hono API、认证、Drizzle Store、上传、Provider、任务投递
worker/    BullMQ 消费与业务 Job
shared/    跨进程最小契约
drizzle/   SQLite migration
tests/     单元与端到端测试
scripts/   OpenAPI/SDK、模型、TOS、FFmpeg 专项脚本
deploy/    Nginx 与 systemd 配置
```

`web/api/generated/`、`openapi/openapi.json`、`drizzle/meta/` 均为生成物，禁止手工修改。

## 当前能力

- 账号、JWT 会话、资料/密码/偏好/通知、用户资源隔离。
- 素材上传、文件夹、商品多图、预置/克隆音色和人像库；私有对象使用签名读取。
- 爆款二创、一键成片、口播脚本等专用创作流程，以及通用异步工具任务。
- 任务持久化、幂等提交、取消、重试、恢复、SSE 更新、结果交付和部分成功。
- 充值订单仅为本地 Mock，不产生真实支付。

功能是否对用户开放以 `web/app/config.ts` 的 `APP_CONFIG` 为准。

