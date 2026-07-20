# 一键成片两栏工作台实施计划

## 1. 数据与领域模型

- 在 `server/db/schema.ts` 增加一键成片项目、脚本段落版本和分镜表。
- 使用 Drizzle Kit 生成新 migration，并通过 `db:check`。
- 新增 `server/video-create/` 领域类型和 Store，集中实现 owner 隔离、状态机、版本检查和聚合查询。
- 补充 Store 与状态机单元测试。

## 2. 专用 OpenAPI 契约

- 在 `server/app.ts` 定义项目 CRUD、AI 填参、脚本生成/编辑/换版、分镜生成/重试/替代和合并接口。
- 所有写接口校验 owner、项目阶段、幂等键和预期版本。
- 导出 OpenAPI 并重新生成前端 SDK，不手改生成文件。
- 补充 API 契约、鉴权和错误响应测试。

## 3. Worker 真实任务链路

- 新增 `worker/jobs/definitions/video-create.ts` 的细化阶段和专用 `job-video-create.ts` Handler。
- 为商品分析、脚本生成、单段换版和分镜规划调用真实结构化模型接口。
- 为每个分镜复用 Seedance 上游提交、轮询、核对和暂存清理能力。
- 配音、字幕和合并复用现有 Provider 与 FFmpeg，所有状态回写 SQLite。
- 测试环境允许显式 Mock 视频阶段；生产拒绝 Mock 回退。
- 补充 Worker 状态推进、部分失败、恢复与幂等测试。

## 4. 两栏工作台前端

- 新建 `web/features/video-create/` 页面、样式和领域组件。
- 在路由中让 `video-create` 使用专用页面，移除它对通用 `ModulePage` 的依赖。
- 实现左侧参数、商品/人像/音色选择、AI 填参和高级设置。
- 实现右侧脚本/分镜 Tab、逐段编辑/换版、逐镜头重试/替代、合并门槛和生成记录抽屉。
- 使用生成 SDK 与 TanStack Query，同步后台真实状态并恢复项目。
- 适配 `1440×900`、`1024×768` 和更窄单栏切换。

## 5. 验证与交付

- 新增单元、API/Worker 集成和 Playwright 用例。
- 运行 `bun run db:generate`、`bun run db:check`、`bun run api:spec`、`bun run api:generate`。
- 运行相关单测、`bun run typecheck`、`bun run build` 和 E2E。
- 运行真实商品分析、脚本、单段换版和分镜结构化测试。
- 耗时视频自动化使用显式 Mock；真实视频冒烟单独记录执行情况。
- 核对最终 diff，只包含本功能与生成产物。
