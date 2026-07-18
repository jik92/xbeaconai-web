# 工作台账号与全局交互设计

## 目标

把曜作工作台顶部和侧栏中现有的静态入口升级为可以完整使用、可持久化且按账号隔离的产品功能。本轮移除顶部“创作中心”按钮，实现偏好设置、帮助中心、通知中心、个人资料和模拟充值，并补齐 SQLite 多账号、JWT 登录、注册、退出及密码设置。完成后，未登录用户不能进入创作工作台，登录用户只能访问自己的任务、余额、偏好和通知。

## 已确认的产品决策

- 账号采用 SQLite 多账号模型。
- 身份凭据使用 JWT，前端按用户要求存入 `localStorage`，请求通过 `Authorization: Bearer <token>` 发送。
- 密码使用 `Bun.password` 安全哈希，任何响应、日志和本地存储都不得出现明文密码。
- 充值采用完整本地模拟支付：套餐选择、确认、余额更新、充值记录和幂等保护均真实经过服务端，但不调用真实支付平台，界面必须明确标注“模拟支付”。
- 个人资料支持修改昵称、邮箱和头像缩写。
- 本轮不引入第三方身份、短信、邮件或真实支付服务。

## 范围

### 顶部栏

- 删除“创作中心”按钮及相关图标和样式。
- 搜索框利用释放出的空间重新布局，保持桌面和平板响应式表现。
- 充值入口展示当前账号余额并打开充值抽屉。
- 问号打开帮助中心。
- 通知铃铛展示未读标记并打开通知面板。
- 头像打开个人菜单，提供资料、安全设置和退出登录入口。

### 侧栏

- 左下角“偏好设置”打开偏好设置抽屉。
- 现有导航、收起导航和版本信息继续工作。

### 账号

- 注册、登录、退出、获取当前用户。
- 修改个人资料。
- 修改密码，要求验证当前密码。
- 修改密码后撤销该用户所有现有会话，并要求重新登录。
- JWT 到期、会话撤销或账号停用时清理前端 Token 并返回登录页。

### 用户数据

- 用户余额、偏好、通知和充值记录按用户隔离。
- 现有任务增加所有者，列表、详情、取消、重试和 SSE 均校验所有权。
- 上传与结果资源继续使用不可预测 ID；业务访问必须经过所属任务或所属用户授权。

## 不在本轮范围

- 邮箱验证、找回密码、短信验证码和社交登录。
- 真实支付、退款、发票、订阅和支付回调。
- 企业组织、团队、角色权限和公网多租户部署。
- 管理后台；账号相关的自助资料与安全设置属于本轮范围。

## 架构

### 数据库

在现有 SQLite 数据库中增加以下表：

```text
users
  id, email, password_hash, display_name, avatar_text,
  credits, status, password_version, created_at, updated_at

auth_sessions
  id, user_id, jti, expires_at, revoked_at, created_at, last_seen_at

user_preferences
  user_id, theme, default_ratio, language,
  task_notifications, autoplay_results, updated_at

notifications
  id, user_id, type, source_id, title, body, read_at, created_at

recharge_orders
  id, user_id, idempotency_key, package_id,
  amount_cny, credits, balance_after, request_fingerprint,
  status, created_at, completed_at

media_assets
  id, owner_user_id, original_name, storage_key, mime_type,
  byte_size, expires_at, created_at

artifacts
  id, owner_user_id, job_id, storage_key, name, mime_type,
  execution_mode, expires_at, created_at

job_inputs
  job_id, asset_id, created_at

migration_state
  key, value, updated_at
```

现有 `jobs` 表增加 `owner_user_id`。上传成功先创建 `media_assets`，任务输入通过 `job_inputs` 关联；任务产物创建 `artifacts`。业务响应只返回 opaque artifact ID 和授权下载路由，不再把文件名作为资源标识。`storage_key` 只在服务端使用且不能由调用方控制。所有用户数据表使用用户外键；账号不做物理删除。任务删除时产物按保留策略清理，资源仍被其他任务引用时不得删除。

数据库约束包括：规范化邮箱唯一、会话 JTI 唯一、`UNIQUE(user_id, idempotency_key)`、`credits` 为非负整数且不超过 `2^53-1`、用户和订单状态使用 `CHECK` 枚举、金额和积分为正整数、所有者字段在新写入中非空。充值订单保存不可变的套餐、金额和积分快照。SQLite 启用的 WAL、busy timeout 和外键约束保持不变。

旧任务、上传和产物没有所有者。首次注册事务使用 `BEGIN IMMEDIATE` 串行化，在 `migration_state` 中原子插入唯一 `legacy_owner_user_id`；只有成功插入标记的事务可以接管全部 `owner_user_id IS NULL` 的任务、相关 `job_inputs`、上传和产物。接管、标记和账号初始化在同一事务提交，任一步失败均整体回滚。无任务引用的旧文件不自动归属账号，登记为待清理资源。启动迁移可重复执行，并能从旧 schema、已完成 schema和失败后已回滚的数据库恢复；发现已提交的部分归属状态时必须拒绝启动并报告修复要求。

### 认证与 JWT

- 注册时规范化邮箱、校验密码强度、使用 `Bun.password.hash` 生成哈希，并在事务中创建默认偏好和欢迎通知。
- 登录时使用恒定行为验证凭据，错误统一返回“邮箱或密码错误”，避免账号枚举。
- 登录成功创建 `auth_sessions` 记录并签发 JWT。`sid` 严格等于 `auth_sessions.id`，`jti` 严格等于 `auth_sessions.jti`；两者都必须与 `sub == auth_sessions.user_id` 同时匹配，任何交叉账号组合均无效。
- 签名使用 HS256 和服务端 `JWT_SECRET`。生产启动必须提供至少 32 字节的密钥；开发环境缺少时生成进程级随机密钥并输出不含密钥内容的警告。
- JWT 固定 `iss: "yaozuo-local"`、`aud: "yaozuo-web"`，只接受 HS256，最长有效期 12 小时，时钟偏差最多 30 秒。每个受保护请求验证算法、issuer、audience、签名、时间、用户状态、密码版本，以及 sid/jti/sub 完全匹配且未撤销的会话。`last_seen_at` 最多每 5 分钟写一次。
- 退出时撤销当前会话。修改密码后递增 `password_version` 并撤销该用户全部会话。
- 前端仅在 `localStorage` 保存 JWT，不保存密码、密码哈希、会话 ID副本或用户敏感信息。
- 因用户明确选择 localStorage，文档必须说明其 XSS 风险；应用继续保持严格内容来源、避免危险 HTML 注入，并在鉴权失败时立即清理 Token。

### 兼容策略

现有 `/api/session` 本机临时令牌只保留给开发或迁移期工具，不再作为 Web 用户身份。Web SDK 的业务请求使用 Bearer JWT。E2E 环境通过测试注册用户获得 JWT，不绕过所有权检查。服务仍默认绑定回环地址；公网部署需要额外的 HTTPS、速率限制、密钥管理和安全响应头验收。

## API 设计

所有路由使用 `@hono/zod-openapi` 定义并进入生成 SDK。每条路由使用稳定 `operationId`；生成结果不得包含业务字段 `unknown`。

### 认证与账号

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
PATCH /api/account/profile
POST /api/account/change-password
```

注册输入：邮箱、密码、昵称。登录输入：邮箱、密码。成功响应返回 JWT、过期时间和当前用户摘要。用户摘要包含 ID、邮箱、昵称、头像缩写和余额，不包含密码相关字段。

```ts
interface AuthResponse {
  token: string
  tokenType: "Bearer"
  expiresAt: string
  user: UserSummary
}

interface UserSummary {
  id: string
  email: string
  displayName: string
  avatarText: string
  credits: number
}

interface UpdateProfileRequest {
  email: string
  displayName: string
  avatarText: string
}

interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}
```

注册和登录返回 `201/200 AuthResponse`；验证失败 `422`，重复邮箱或修改资料时邮箱冲突 `409`，登录凭据错误和当前密码错误分别为 `401 INVALID_CREDENTIALS` 与 `400 CURRENT_PASSWORD_INVALID`，限流为 `429`。`GET /auth/me` 的过期、撤销、停用统一 HTTP `401` 并保留稳定错误码。退出使用特殊认证路径：先验证签名、算法、issuer、audience、时间和 sid-jti-sub 绑定，再查询匹配会话；会话尚未撤销时执行撤销，已撤销时幂等返回 `204`。过期、伪造或跨用户组合的 Token 仍返回 `401`。普通受保护路由继续拒绝已撤销会话。修改邮箱不撤销会话，后续 `/me` 立即返回新邮箱。修改密码成功返回 `204`，随后当前和其他旧 Token 均无效。

### 偏好设置

```text
GET /api/preferences
PUT /api/preferences
```

设置项为主题、默认生成比例、语言、任务完成通知和结果自动播放。主题本轮支持 `light | system`；当前视觉体系没有完成暗色主题，因此不暴露无效的 `dark` 选项。

`GET` 返回完整 `Preferences`；`PUT` 要求完整对象并返回保存后的完整对象，不采用模糊 patch。非法枚举或缺字段返回 `422`。

### 通知

```text
GET  /api/notifications
POST /api/notifications/{notificationId}/read
POST /api/notifications/read-all
```

列表按 `createdAt DESC, id DESC` 返回最近 50 条、未读数量和可选 `before` 游标。单条与全部已读返回更新后的 `unreadCount`。不存在或非所有者通知返回 `404`。注册成功、模拟充值成功和任务完成可以产生通知。`source_id` 对 `task_completed` 和 `recharge_succeeded` 必填，分别保存任务 ID 和订单 ID；欢迎通知允许 NULL。数据库创建 `UNIQUE(user_id, type, source_id) WHERE source_id IS NOT NULL`，明确利用 partial index 排除 NULL。同一终态事件重放只返回已有通知，不重复创建；旧 schema 迁移为历史通知补 NULL，并通过任务/订单回填可识别来源。

### 模拟充值

```text
GET  /api/recharge/packages
GET  /api/recharge/orders
POST /api/recharge/orders
```

套餐由服务端固定配置返回。创建订单 body 只包含 `packageId`，幂等键放在 `Idempotency-Key` header；在一个 `BEGIN IMMEDIATE` 事务中创建成功订单、通过 `credits <= MAX - packageCredits` 条件更新余额、把更新后的余额持久化为订单不可变 `balance_after`，并创建通知。请求指纹为规范化路由、用户和 package ID 的摘要。同用户相同幂等键与相同指纹直接从订单读取原始 `balance_after` 并返回原订单，不重复增加余额；即使其间完成其他充值，重放响应也保持不变。相同键但不同 package 返回 HTTP `409 IDEMPOTENCY_CONFLICT`。未知套餐返回 `404 RECHARGE_PACKAGE_NOT_FOUND`，缺少幂等键返回 `400`。订单列表按 `createdAt DESC, id DESC` 返回最近 50 条和游标。响应明确包含 `paymentMode: "mock"`。

```ts
interface RechargeOrder {
  id: string
  packageId: string
  amountCny: number
  credits: number
  status: "succeeded"
  paymentMode: "mock"
  balanceAfter: number
  createdAt: string
}
```

### 任务所有权

以下现有路由增加 Bearer JWT 验证和用户过滤：

```text
POST /api/uploads
GET  /api/jobs
POST /api/{moduleId}/jobs
GET  /api/jobs/{jobId}
POST /api/jobs/{jobId}/cancel
POST /api/jobs/{jobId}/retry
GET  /api/jobs/{jobId}/events
GET  /api/artifacts/{artifactId}
```

非所有者访问资源统一返回 `404`，避免泄露其他账号是否存在对应资源。上传响应返回 `assetId`；任务只接受当前用户拥有且未过期的 asset ID。产物预览与下载通过 artifact ID 查询数据库所有者和服务端 storage key。过期资源返回 `410` 仅限所有者；其他账号始终得到 `404`。

### HTTP 状态与错误契约

所有受保护路由文档化 `401`；所有 ID 路由文档化 `404`；可变状态冲突使用 `409`；Zod 输入错误使用 `422`；速率限制使用 `429`；数据库暂时不可用使用可重试 `503`。每种响应都使用具名 schema 与稳定错误码。契约测试逐一断言注册、登录、资料邮箱冲突、Token 过期/撤销/停用、当前密码错误、充值键冲突、所有权隐藏 404、登出重放和输入校验响应。

## 前端结构

### 会话层

新增 `AuthProvider` 负责：

- 从 `localStorage` 恢复 JWT。
- 调用 `/api/auth/me` 恢复当前用户。
- 为生成 SDK 注入 Bearer Token。
- 提供注册、登录、退出和刷新用户摘要方法。
- 捕获 `401` 后清理会话并展示登录界面。

鉴权客户端同时提供基于 `fetch` + `ReadableStream` 的 SSE 解析器，使其可以发送 Authorization header、`Last-Event-ID` 并做有界重连。禁止使用不能携带 header 的原生 `EventSource`，禁止把 JWT 放入 query string。SSE 收到 `401` 时触发统一退出；另一个账号订阅任务事件必须得到 `404`。

路由根根据会话状态显示加载页、登录/注册页或 `AppShell`。登录与注册使用同一张认证卡片切换，包含密码显隐、字段校验、提交状态和错误提示。

### 全局工作台层

`AppShell` 只负责布局和面板协调，具体功能拆分为独立组件：

```text
src/features/account/auth-screen.tsx
src/features/account/profile-panel.tsx
src/features/account/security-panel.tsx
src/features/preferences/preferences-panel.tsx
src/features/notifications/notification-panel.tsx
src/features/recharge/recharge-panel.tsx
src/features/help/help-panel.tsx
src/components/domain/global-overlay.tsx
```

全局同时只打开一个面板。点击遮罩、关闭按钮或 Esc 关闭。打开面板后焦点进入标题或第一个控件；关闭时焦点返回触发按钮。移动端使用全屏抽屉，桌面使用右侧抽屉或锚定菜单。

### 充值

- 顶部入口显示实时余额。
- 充值抽屉展示套餐、到账创作点、模拟金额和充值记录。
- 用户选择套餐后进入确认步骤，明确显示“模拟支付，不产生真实扣款”。
- 提交期间禁止重复操作；成功后刷新余额、订单和通知未读数。

### 帮助

帮助中心包含快速入门、工作流说明、Mock/真实来源说明、常见问题和快捷键。反馈入口使用本地可复制的支持信息，不伪造尚未接入的在线客服或工单 API。

### 通知

- 铃铛显示未读圆点或数量。
- 支持逐条已读和全部已读。
- 空状态和加载失败状态明确可见。

### 个人信息与安全

- 头像菜单展示昵称、邮箱、余额、资料设置、安全设置和退出。
- 资料抽屉支持昵称、邮箱和最多两个字符的头像缩写。
- 修改密码要求当前密码、新密码和确认密码；成功后清理 JWT 并回到登录页。

### 偏好设置

- 主题：跟随系统或浅色。
- 默认画面比例：9:16、16:9 或 1:1。
- 默认语言：简体中文或 English。
- 任务完成通知开关。
- 自动播放结果开关。

保存成功后更新服务端，并让适用的 UI 行为立即生效。表单支持取消，取消时恢复服务端最后保存状态。

所有面板必须覆盖 loading、empty、success 和 failure：`/me` 网络失败显示重试而不是误判为未登录；登录注册限流保留输入；资料邮箱冲突不覆盖当前资料；偏好保存失败保留 dirty 状态并在关闭前确认；充值失败或幂等冲突重新获取订单与余额；通知已读失败回滚或重新获取；会话在任意抽屉或任务 SSE 中过期时清理敏感 UI 并跳回登录；充值记录空状态与加载失败状态分别显示。

## 错误与安全

统一错误继续使用 `ApiErrorResponse`，新增稳定错误码：

```text
EMAIL_ALREADY_REGISTERED
INVALID_CREDENTIALS
TOKEN_EXPIRED
SESSION_REVOKED
ACCOUNT_DISABLED
CURRENT_PASSWORD_INVALID
PASSWORD_TOO_WEAK
RECHARGE_PACKAGE_NOT_FOUND
IDEMPOTENCY_CONFLICT
```

- 邮箱进行 trim 和小写规范化，并限制长度。
- 密码最少 10 位，至少包含字母和数字，最大 128 位。
- 注册、登录和修改密码设置低噪声速率限制；回环开发环境也不跳过。
- JWT 和密码不得记录到日志或错误消息。
- localStorage 的键使用版本化固定名称，退出时彻底删除。
- 本轮生产响应加入 CSP、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`X-Frame-Options: DENY` 和合理的 `Permissions-Policy`。CSP 只允许构建产物所需的同源脚本、样式、图片、媒体和连接；源码禁止 `dangerouslySetInnerHTML`，若未来必须渲染富文本需集中净化。
- 自动测试扫描源码和网络请求，证明 JWT 不进入 URL、DOM 文本、IndexedDB、错误响应、日志和测试截图；浏览器存储中只允许版本化 Token 键。
- 所有 SQL 使用参数化查询。
- 模拟充值只允许服务端套餐 ID，客户端不能提交任意积分数。
- 用户余额使用整数，SQLite 事务内更新，禁止客户端直接设置。

## 数据流

### 登录恢复

```text
读取 localStorage JWT
  -> 无 Token：显示登录页
  -> 有 Token：GET /api/auth/me
      -> 成功：显示工作台
      -> 401：清理 Token，显示登录页
```

### 模拟充值

```text
选择套餐 -> 生成幂等键 -> POST 模拟订单
  -> SQLite 事务：订单 + 余额 + 通知
  -> 刷新用户摘要、订单列表和未读通知
```

### 任务提交

```text
Bearer JWT -> 解析用户 -> 创建 owner_user_id 任务
  -> SQLite/内存队列/SSE 保持原有执行链
  -> 终态按偏好创建一次通知
```

## 验收标准

### 账号

- 新用户可注册并自动进入工作台。
- 重复邮箱不能注册。
- 正确凭据可登录，错误凭据返回统一错误。
- 刷新页面可通过 JWT 恢复登录。
- 退出后 Token 被撤销且不能再次使用。
- 修改资料后顶部头像和账号摘要立即更新。
- 修改密码必须验证当前密码，成功后旧 Token 失效并返回登录页。
- 两个账号互相看不到任务、通知、余额、偏好和充值记录。
- 两个账号互相不能查询或使用上传资源，不能预览、下载或订阅对方产物与任务 SSE。

### 顶栏与设置

- DOM 中不再存在“创作中心”按钮。
- 充值、帮助、通知、头像和侧栏偏好设置均能打开、操作和关闭。
- 模拟充值只增加一次余额，刷新后余额和记录仍存在。
- 并发相同充值请求只增加一次余额；相同键不同套餐稳定返回冲突。
- 第一次充值后再完成其他充值，重放第一次幂等键仍返回第一次持久化的 `balanceAfter`。
- 通知支持单条与全部已读，刷新后状态仍存在。
- 个人资料和偏好设置刷新后仍存在。
- 所有入口拥有可访问名称，键盘和 Esc 可操作。

### 回归

- OpenAPI 和生成 SDK 无漂移。
- 单元测试覆盖密码规则、JWT issuer/audience/算法/时间、sid-jti-sub 绑定、会话撤销、停用账号、密码版本、数据库隔离和充值幂等。
- API 测试覆盖全部新增路由的成功与失败响应。
- 登出契约测试区分已撤销会话的幂等 `204` 与过期、伪造、sid-jti-sub 跨用户 Token 的 `401`。
- Playwright 覆盖注册、登录、五项全局功能、修改密码和退出。
- Playwright 使用两个真实测试账号证明任务隔离。
- 迁移测试从当前精确旧 schema 验证重复迁移、并发首次注册、事务中途失败回滚、历史任务/上传/产物整体接管、未引用旧文件清理和部分迁移状态拒绝启动。
- 通知迁移和重复终态事件测试验证 `source_id` 回填、partial unique index 与无来源欢迎通知可共存。
- 浏览器测试验证鉴权 fetch-SSE 重连与跨账号订阅拒绝。
- UI 测试覆盖 `/me` 网络失败、登录限流、资料冲突、偏好 dirty 关闭、充值与通知失败回滚、抽屉打开时会话过期以及充值记录 empty/error 状态。
- 原有 12 个创作模块桌面与平板流程继续通过。
- `bun run typecheck`、单元测试、生产构建和完整 E2E 全部通过。

## 交付与运行

- 新增 `.env.example`，只列变量名和安全说明，不包含真实密钥。
- README 增加 JWT 配置、首次注册和模拟充值说明。
- OpenAPI 和生成 SDK 重新提交。
- 生产服务仍默认绑定 `127.0.0.1`；本轮完成 CSP 和基础安全响应头。如要对外提供访问，必须另行完成 HTTPS、localStorage JWT 风险评估、反向代理和公网速率限制验收。
