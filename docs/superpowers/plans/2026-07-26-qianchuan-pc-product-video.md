# 千川 PC 商品短视频投放 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在烽火AI中实现千川代理商 OAuth 商户绑定、素材上传、PC 商品短视频计划组/计划/创意创建和报表查看。

**Architecture:** APP 凭据进入现有 AES-256-GCM 密钥管理；OAuth Token 按用户和授权主体单独加密。Hono API 负责授权、校验和查询，BullMQ Worker 负责上游素材、投放和报表操作，React 页面通过生成 SDK 使用这些能力。

**Tech Stack:** Bun、TypeScript strict、Hono OpenAPI、SQLite/Drizzle、BullMQ、React 19、TanStack Router/Query/Table、Tailwind CSS

## Global Constraints

- 第一阶段只实现千川 PC 商品短视频推广。
- 默认创建暂停对象；无法保证暂停时阻止真实提交。
- API Server 不执行异步任务，Worker 不承载 HTTP。
- Secret、Token 和授权码不得进入日志或前端响应。
- 不手工修改生成文件，使用现有脚本生成 OpenAPI、SDK 和 migration。
- 按用户要求，不运行测试、E2E、类型检查或构建。
- 对话中暴露的旧 Secret 不写入任何文件。

---

### Task 1: 千川全局凭据

**Files:**
- Modify: `server/byok/credential-definitions.ts`
- Modify: `server/byok/credential-doctor.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `QIANCHUAN_APP_ID`、`QIANCHUAN_APP_SECRET`
- Produces: `qianchuan` Provider 配置状态

- [ ] 在凭据目录加入 APP ID 和 APP Secret，并只将 Secret 标记为敏感。
- [ ] Doctor 校验两项存在且 APP ID 为数字，不调用付费或写入接口。
- [ ] `.env.example` 仅加入空变量名。
- [ ] 使用 `HUSKY=0` 提交。

### Task 2: PC 投放数据模型

**Files:**
- Modify: `server/db/schema.ts`
- Modify: `server/db/database.ts`
- Create: `server/qianchuan/types.ts`
- Create: `server/qianchuan/crypto.ts`
- Create: `server/qianchuan/store.ts`
- Generated: `drizzle/0018_*.sql`

**Interfaces:**
- Produces: `QianchuanStore`
- Produces: owner-scoped binding、advertiser、material、campaign、ad、creative、report CRUD

- [ ] 定义 OAuth state、绑定、投放账户、素材映射、投放记录和报表表。
- [ ] 为 owner、binding、advertiser 和上游 ID 建立唯一索引。
- [ ] 使用 `BYOK_ENCRYPTION_KEY` 派生用途密钥加密 Token。
- [ ] 实现 owner-scoped Store 和幂等创建。
- [ ] 运行 `bun run db:generate` 生成 migration，但不运行 migration 检查。
- [ ] 为旧库启动修复增加 `CREATE TABLE IF NOT EXISTS`。
- [ ] 使用 `HUSKY=0` 提交。

### Task 3: OAuth state 与千川客户端

**Files:**
- Create: `server/qianchuan/oauth-state.ts`
- Create: `server/qianchuan/client.ts`

**Interfaces:**
- Produces: `createOAuthState(ownerUserId)`
- Produces: `consumeOAuthState(state)`
- Produces: `QianchuanClient.exchangeCode`
- Produces: `QianchuanClient.refreshToken`
- Produces: 账户、商品、抖音号、素材、计划组、计划、创意、审核和报表方法

- [ ] 实现十分钟、一次性、绑定 owner 的 OAuth state。
- [ ] 统一 `https://api.oceanengine.com` 响应包络和结构化错误。
- [ ] 实现 OAuth 换取与刷新 Token。
- [ ] 实现授权主体与代理商关联投放账户查询。
- [ ] 实现可投商品、已授权抖音号、视频和图片素材接口。
- [ ] 实现计划组、计划、创意创建/查询/状态接口。
- [ ] 实现账户、计划、素材报表接口。
- [ ] 真实创建方法不自动重试，并过滤敏感错误字段。
- [ ] 使用 `HUSKY=0` 提交。

### Task 4: 商户绑定 API

**Files:**
- Create: `server/qianchuan/routes.ts`
- Modify: `server/app.ts`

**Interfaces:**
- Produces: `GET /api/qianchuan/config`
- Produces: `POST /api/qianchuan/oauth/start`
- Produces: `GET /callback`
- Produces: `GET /api/qianchuan/bindings`
- Produces: `PUT /api/qianchuan/bindings/{bindingId}/default-advertiser`
- Produces: `DELETE /api/qianchuan/bindings/{bindingId}`

- [ ] 注册精确公共 callback 路径，只接受有效 state。
- [ ] OAuth start 由服务端生成授权 URL。
- [ ] callback 换 Token、同步主体和账户并重定向绑定页。
- [ ] 列表只返回掩码状态和非敏感账户信息。
- [ ] 默认账户与解绑严格校验 owner。
- [ ] 使用 `HUSKY=0` 提交。

### Task 5: 千川 Worker 任务

**Files:**
- Modify: `shared/jobs/queue-contract.ts`
- Modify: `shared/jobs/job-workload.ts`
- Create: `worker/jobs/definitions/qianchuan-pc.ts`
- Modify: `worker/jobs/definitions/index.ts`
- Create: `worker/jobs/job-qianchuan-pc.ts`
- Modify: `worker/jobs/registry.ts`

**Interfaces:**
- Produces: `qianchuan-material-upload`
- Produces: `qianchuan-pc-submit`
- Produces: `qianchuan-pc-sync`

- [ ] 队列消息只保存本地记录 ID。
- [ ] 素材任务下载当前用户私有 TOS 素材并上传目标账户。
- [ ] 提交任务依次创建计划组、计划、创意并保存每一级 ID。
- [ ] 每次恢复先检查已保存上游 ID，避免重复创建。
- [ ] 同步任务刷新 Token、审核状态和报表。
- [ ] 将权限/余额/参数错误标为不可重试，将限流/超时标为可重试。
- [ ] 将专用 handler 注册在 fallback 前。
- [ ] 使用 `HUSKY=0` 提交。

### Task 6: 素材、投放与报表 API

**Files:**
- Modify: `server/qianchuan/routes.ts`
- Modify: `server/app.ts`

**Interfaces:**
- Produces: 商品、抖音号和素材查询接口
- Produces: `POST /api/qianchuan/materials`
- Produces: `POST /api/qianchuan/pc-deliveries/confirm`
- Produces: `POST /api/qianchuan/pc-deliveries`
- Produces: 投放列表、详情、状态、启停、同步与报表接口

- [ ] 校验本地素材 owner 和 advertiser 绑定。
- [ ] 发布素材上传任务并返回本地状态。
- [ ] 校验商品、抖音号、素材、预算、出价/ROI、日期、时段和基础定向。
- [ ] 生成十分钟一次性真实写入确认令牌。
- [ ] 创建本地投放记录后发布 Worker 任务。
- [ ] 状态修改必须再次确认，并禁止隐式启用。
- [ ] 投放与报表查询按 owner 和 advertiser 隔离。
- [ ] 使用 `HUSKY=0` 提交。

### Task 7: OpenAPI 与页面 API

**Files:**
- Generated: `openapi/openapi.json`
- Generated: `web/api/generated/`
- Modify: `web/api/api-client.ts`
- Create: `web/features/qianchuan/qianchuan-api.ts`

**Interfaces:**
- Produces: 页面使用的 config、binding、material、delivery、report query/mutation

- [ ] 运行 `bun run api:spec`。
- [ ] 运行 `bun run api:generate`。
- [ ] 增加页面级生成 SDK 薄封装。
- [ ] 不运行类型检查或构建。
- [ ] 使用 `HUSKY=0` 提交。

### Task 8: 菜单、路由与商户绑定页面

**Files:**
- Modify: `web/app/config.ts`
- Modify: `web/app/router.tsx`
- Modify: 实际侧边栏菜单文件
- Create: `web/features/qianchuan/qianchuan-merchant-binding-page.tsx`

**Interfaces:**
- Produces: “投放”分组
- Produces: `/delivery/qianchuan-merchants`

- [ ] 注册“千川商户绑定”和“千川PC投放”入口。
- [ ] 商户绑定页展示配置、授权主体、账户、默认账户和 Token 状态。
- [ ] 授权按钮使用服务端 OAuth URL。
- [ ] 支持默认账户和解除本地绑定。
- [ ] 页面只保留主标题，不新增说明性副标题。
- [ ] 使用 `HUSKY=0` 提交。

### Task 9: 千川 PC 投放页面

**Files:**
- Create: `web/features/qianchuan/qianchuan-pc-delivery-page.tsx`
- Modify: `web/app/router.tsx`

**Interfaces:**
- Produces: `/delivery/qianchuan-pc`

- [ ] 提供账户、商品、抖音号、本地视频和封面选择。
- [ ] 提供计划组/计划/创意、预算、出价/ROI、日期、时段和基础定向输入。
- [ ] 展示素材上传状态和上游素材 ID。
- [ ] 提交前展示真实账户、商品、素材、预算和时间确认 Modal。
- [ ] 使用幂等键提交，并默认暂停。
- [ ] DataTable 展示计划组/计划/创意 ID、审核状态、启停状态和错误。
- [ ] 提供账户/计划/素材报表和日期筛选。
- [ ] 使用 `HUSKY=0` 提交。

### Task 10: 静态交付审计

**Files:**
- Modify: `docs/superpowers/plans/2026-07-26-qianchuan-pc-product-video.md`

- [ ] 检查 `git status --short`，保留用户 `.DS_Store`。
- [ ] 检查版本控制文件没有 Secret、Token 或授权码。
- [ ] 逐项核对菜单、页面、callback、素材、投放、状态与报表代码证据。
- [ ] 不运行测试、E2E、类型检查或构建。
- [ ] 交付说明列出未验证状态、Secret 轮换、权限确认、生产迁移和真实账户冒烟要求。
