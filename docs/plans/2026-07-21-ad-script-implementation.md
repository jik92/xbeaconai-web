# 口播脚本重新实现实施计划

## 1. 领域模型与迁移

- 在 `server/ad-script/types.ts` 定义输入、场景、评分、合规、变体与版本类型和 Zod Schema。
- 在 `server/db/schema.ts` 增加项目、变体和版本表及 owner、状态、幂等索引。
- 在 `server/ad-script/ad-script-store.ts` 用 Drizzle 实现 owner 隔离、项目聚合、版本追加、当前版本切换和状态推进。
- 运行 `bun run db:generate`，提交新 migration，并用 `bun run db:check` 验证。

## 2. 规则、Provider 与 Worker

- 在 `server/ad-script/compliance.ts` 实现确定性广告合规、字数和 CTA 规则。
- 扩展 `server/providers/aihubmix.ts`，支持调用固定模型时配置足够的 token、JSON 输出和温度。
- 新增 `worker/jobs/job-ad-script.ts`，实现生成、四维评分、合规、最多五轮改写、提前停止、持久化和整批失败退款。
- 在 `worker/jobs/registry.ts` 将专用 Handler 注册在通用 fallback 之前。

## 3. 专用 API 与 SDK

- 在 `server/app.ts` 增加已有脚本解析、创建项目、项目查询、人工版本保存、重新评分、继续调优、取消和 TXT/Markdown 导出路由。
- 创建任务时复用现有 Job、BullMQ、SSE、鉴权和创作点账本；保证幂等扣费和整批失败退款。
- 运行 `bun run api:spec` 和 `bun run api:generate`，只通过生成器更新 OpenAPI 与 SDK。

## 4. 独立前端

- 新增 `web/features/ad-script/ad-script-page.tsx` 与 `ad-script-page.css`。
- 实现三步输入、草稿、解析确认、费用摘要、真实任务进度、A/B 变体、评分、合规、版本、编辑和导出。
- 在 `web/app/router.tsx` 将 `ad-script` 路由切到独立页面。
- 视觉使用现有 Token；验证 `1440×900` 与 `1024×768`。

## 5. 测试与验收

- 增加领域规则、Store、API、Worker 恢复和计费测试。
- 增加三步流程、状态恢复、版本编辑和导出的 E2E。
- 运行 `make ci`、`bun run db:check`、`bun run typecheck`、`bun run build` 和 `bun run e2e`。
- 使用仓库真实模型测试路径验证 `deepseek/deepseek-v4-pro`；若环境缺少密钥或额度，记录未验证原因，运行时不降级。
