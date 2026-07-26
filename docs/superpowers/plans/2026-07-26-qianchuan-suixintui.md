# 巨量千川随心推 Implementation Plan（已废弃）

> 2026-07-26：产品方向已改为千川 PC 商品短视频推广。本计划不再执行，以
> `docs/superpowers/plans/2026-07-26-qianchuan-pc-product-video.md` 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在烽火AI中实现千川代理商 OAuth 绑定、账户选择、素材映射、短视频随心推订单创建与报表查看。

**Architecture:** 全局 APP 凭据进入现有 AES-256-GCM 密钥管理；OAuth Token 以用户和授权主体为边界单独加密持久化。API Server 处理授权与查询，BullMQ Worker 执行素材上传、真实订单提交和报表同步，前端通过生成 SDK 访问受保护接口。

**Tech Stack:** Bun、TypeScript strict、Hono OpenAPI、SQLite/Drizzle、BullMQ、React 19、TanStack Router/Query/Table、Tailwind CSS

## Global Constraints

- 第一阶段只实现千川随心推短视频带商品链路。
- 真实订单必须经过显式确认和幂等保护。
- API Server 不执行长耗时或可重试的上游任务。
- OAuth Token 和应用 Secret 不得进入日志、前端响应或审计明文。
- 不手工修改 `web/api/generated/`、`openapi/openapi.json` 或 `drizzle/meta/`。
- 按用户要求，本次不运行测试、E2E、类型检查或构建。
- 对话中已经暴露的旧 APP Secret 不写入任何文件。

---

## 文件结构

- `server/qianchuan/types.ts`：千川领域类型和上游响应包络。
- `server/qianchuan/crypto.ts`：OAuth Token 的 AES-256-GCM 加解密。
- `server/qianchuan/client.ts`：OAuth、账户、素材、随心推订单与报表 HTTP 客户端。
- `server/qianchuan/store.ts`：绑定、账户、素材映射、订单和报表的 Drizzle Store。
- `server/qianchuan/routes.ts`：Hono OpenAPI 路由与用户资源隔离。
- `server/qianchuan/oauth-state.ts`：签名、短期、一次性 OAuth state。
- `worker/jobs/job-qianchuan.ts`：素材上传、订单提交和同步任务。
- `web/features/qianchuan/qianchuan-binding-page.tsx`：绑定与账户页。
- `web/features/qianchuan/qianchuan-suixintui-page.tsx`：订单创建、列表和报表页。
- `web/features/qianchuan/qianchuan-api.ts`：生成 SDK 的页面级封装。

### Task 1: 凭据目录与配置状态

**Files:**
- Modify: `server/byok/credential-definitions.ts`
- Modify: `server/byok/credential-doctor.ts`
- Modify: `.env.example`
- Modify: `tests/unit/provider-credential-store.test.ts`

**Interfaces:**
- Produces: `QIANCHUAN_APP_ID`、`QIANCHUAN_APP_SECRET` 两个 `ProviderCredentialName`
- Produces: `qianchuan` Provider 配置检查结果

- [ ] 在凭据目录新增千川 APP ID 和 APP Secret，并将 Secret 标记为敏感。
- [ ] Doctor 只验证两项已配置且 APP ID 为数字；不发起会产生副作用的上游请求。
- [ ] `.env.example` 只增加空变量名，不写真实 Secret。
- [ ] 更新现有凭据 Store 测试中的目录数量和千川掩码断言，但不执行测试。
- [ ] 使用 `HUSKY=0` 提交本任务。

### Task 2: 数据表与迁移

**Files:**
- Modify: `server/db/schema.ts`
- Create: `drizzle/0018_<generated-name>.sql`
- Modify: `server/db/database.ts`
- Create: `server/qianchuan/types.ts`
- Create: `server/qianchuan/store.ts`

**Interfaces:**
- Produces: `QianchuanStore`
- Produces: `QianchuanBinding`、`QianchuanAdvertiser`、`QianchuanMaterial`、`QianchuanOrder`、`QianchuanReport`

- [ ] 定义授权绑定表，保存 owner、授权主体、加密 Token、到期时间、状态和默认账户。
- [ ] 定义账户、素材映射、订单、报表和 OAuth state 表，添加 owner/绑定/上游 ID 唯一索引。
- [ ] 使用 Drizzle ORM 实现 owner-scoped CRUD、幂等订单创建和报表 upsert。
- [ ] 生成新 migration；不得改写历史 migration 或 `drizzle/meta/`。
- [ ] 为旧库启动修复增加必要的 `CREATE TABLE IF NOT EXISTS`，保证生产升级可启动。
- [ ] 使用 `HUSKY=0` 提交本任务。

### Task 3: OAuth 安全与千川客户端

**Files:**
- Create: `server/qianchuan/crypto.ts`
- Create: `server/qianchuan/oauth-state.ts`
- Create: `server/qianchuan/client.ts`

**Interfaces:**
- Produces: `QianchuanClient.exchangeCode(authCode)`
- Produces: `QianchuanClient.refreshToken(refreshToken)`
- Produces: `QianchuanClient.listAuthorizedAccounts(accessToken)`
- Produces: `QianchuanClient.uploadVideo(input)`
- Produces: `QianchuanClient.listAwemeVideos(input)`
- Produces: `QianchuanClient.listAvailableProducts(input)`
- Produces: `QianchuanClient.createAwemeOrder(input)`
- Produces: `QianchuanClient.getAwemeOrders(input)`
- Produces: `QianchuanClient.getAwemeOrderReport(input)`

- [ ] 复用 `BYOK_ENCRYPTION_KEY` 派生独立用途密钥，加密 OAuth Token。
- [ ] 实现数据库持久化、10 分钟有效且一次性消费的 state。
- [ ] 使用 `https://api.oceanengine.com`，请求头采用 `Access-Token`，统一解析 `code`、`message`、`request_id` 和 `data`。
- [ ] 实现 OAuth Token 获取与刷新。
- [ ] 实现随心推 v1.0 账户、商品、视频、创建订单、订单列表/详情和订单报表端点。
- [ ] 对上传使用 multipart；对真实订单创建禁用自动网络重试。
- [ ] 将上游错误映射为不包含 Token、Secret、auth_code 的结构化错误。
- [ ] 使用 `HUSKY=0` 提交本任务。

### Task 4: OAuth 和绑定 API

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

- [ ] 将 `/callback` 加入精确公共路径，但仅接受有效且未消费 state。
- [ ] OAuth start 返回服务端生成的审核授权 URL，不接受前端传入 APP ID 或 callback。
- [ ] callback 换取 Token、同步账户关系，并重定向到绑定页的成功或安全错误状态。
- [ ] 绑定列表只返回掩码状态、主体和账户，不返回 Token。
- [ ] 默认账户更新和解绑必须校验 owner。
- [ ] 在 `server/app.ts` 注册路由，并保持其他公共路径不变。
- [ ] 使用 `HUSKY=0` 提交本任务。

### Task 5: BullMQ 千川任务

**Files:**
- Modify: `shared/jobs/queue-contract.ts`
- Modify: `shared/jobs/job-workload.ts`
- Create: `worker/jobs/job-qianchuan.ts`
- Modify: `worker/jobs/registry.ts`
- Modify: `worker/jobs/definitions/index.ts`
- Create: `worker/jobs/definitions/qianchuan.ts`

**Interfaces:**
- Consumes: `QianchuanStore` 和 `QianchuanClient`
- Produces: `qianchuan-material-upload`、`qianchuan-order-create`、`qianchuan-order-sync` Job handler

- [ ] 定义三类最小队列消息，消息只含本地记录 ID。
- [ ] 素材任务读取 owner 资源、下载私有 TOS 内容、上传千川并保存素材映射。
- [ ] 订单任务读取已确认本地订单，以幂等键避免重复创建，并保存上游订单 ID/request ID。
- [ ] 同步任务刷新 Token、同步订单详情和日期报表。
- [ ] 明确区分权限、余额、参数等不可重试错误和限流/超时可重试错误。
- [ ] 注册专用 handler，并排在通用 fallback 前。
- [ ] 使用 `HUSKY=0` 提交本任务。

### Task 6: 素材、订单与报表 API

**Files:**
- Modify: `server/qianchuan/routes.ts`
- Modify: `server/app.ts`

**Interfaces:**
- Produces: `GET /api/qianchuan/advertisers/{advertiserId}/products`
- Produces: `GET /api/qianchuan/advertisers/{advertiserId}/videos`
- Produces: `POST /api/qianchuan/materials`
- Produces: `POST /api/qianchuan/orders/confirm`
- Produces: `POST /api/qianchuan/orders`
- Produces: `GET /api/qianchuan/orders`
- Produces: `GET /api/qianchuan/orders/{orderId}`
- Produces: `POST /api/qianchuan/orders/{orderId}/sync`
- Produces: `GET /api/qianchuan/reports`

- [ ] 只允许选择当前用户拥有的本地素材和已绑定 advertiser。
- [ ] 素材创建返回本地上传状态并发布 Worker Job。
- [ ] confirm 校验账户、商品、视频、预算、时间和投放目标，返回 10 分钟一次性确认令牌。
- [ ] 创建订单必须携带确认令牌与幂等键，先持久化再发布 Worker Job。
- [ ] 订单和报表查询按 owner、账户和日期隔离。
- [ ] 所有上游错误沿用 `{code,message,retryable,requestId}`。
- [ ] 使用 `HUSKY=0` 提交本任务。

### Task 7: OpenAPI 与生成 SDK

**Files:**
- Generated: `openapi/openapi.json`
- Generated: `web/api/generated/`
- Modify: `web/api/api-client.ts`
- Create: `web/features/qianchuan/qianchuan-api.ts`

**Interfaces:**
- Consumes: Task 4 和 Task 6 的 operationId
- Produces: 页面使用的绑定、账户、素材、订单和报表查询函数

- [ ] 运行 `bun run api:spec`。
- [ ] 运行 `bun run api:generate`。
- [ ] 为页面建立薄封装，统一 auth header 和 API 错误文案。
- [ ] 不运行类型检查或构建。
- [ ] 使用 `HUSKY=0` 提交本任务。

### Task 8: 路由、菜单与绑定页面

**Files:**
- Modify: `web/app/router.tsx`
- Modify: `web/app/config.ts`
- Modify: `web/components/layout/sidebar.tsx` 或实际菜单组件
- Create: `web/features/qianchuan/qianchuan-binding-page.tsx`

**Interfaces:**
- Produces: `/delivery/qianchuan-binding`
- Produces: 一级“投放”分组和“巨量千川绑定”入口

- [ ] 在集中配置中注册“投放”分组和两个子入口，不在组件内另建功能开关。
- [ ] 绑定页展示 APP 配置、OAuth 状态、主体、账户和默认账户。
- [ ] 授权按钮打开服务端返回的 OAuth URL；回调成功后刷新绑定列表。
- [ ] 支持默认账户选择和解除本地绑定。
- [ ] 页面只保留主标题，不新增说明性副标题。
- [ ] 使用 `HUSKY=0` 提交本任务。

### Task 9: 随心推页面

**Files:**
- Create: `web/features/qianchuan/qianchuan-suixintui-page.tsx`
- Modify: `web/app/router.tsx`

**Interfaces:**
- Produces: `/delivery/qianchuan-suixintui`
- Produces: “千川随心推”菜单入口

- [ ] 使用现有素材选择器选择视频，并展示千川上传状态。
- [ ] 选择绑定账户后查询可投商品和可投视频。
- [ ] 提供订单名称、商品、视频、预算、时长、优化目标、出价/ROI输入。
- [ ] 提交前调用 confirm，并用 Modal 展示真实账户、预算、商品、素材和时间。
- [ ] 用户再次确认后携带幂等键创建本地订单。
- [ ] 使用 DataTable 展示订单状态、审核信息、消耗、成交和 ROI。
- [ ] 提供日期筛选与手动同步，不实现自动追加预算。
- [ ] 使用 `HUSKY=0` 提交本任务。

### Task 10: 交付审计

**Files:**
- Modify: `docs/superpowers/plans/2026-07-26-qianchuan-suixintui.md`

- [ ] 检查 `git status --short`，保留用户的 `.DS_Store`，确认无 Secret、Token 或 auth_code。
- [ ] 使用 `rg` 检查旧 Secret 未进入版本控制文件；命令中不得包含 Secret 本身。
- [ ] 核对两个菜单、两个页面、OAuth callback、素材任务、订单任务和报表接口均有代码证据。
- [ ] 不运行测试、E2E、类型检查或构建。
- [ ] 在交付说明中列出未验证状态、上线前必须轮换 Secret、配置生产 `BYOK_ENCRYPTION_KEY`、申请/确认 API 权限。
