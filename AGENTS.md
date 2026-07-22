# AGENTS.md

本文件是本仓库面向编码 Agent 的工作说明，适用于仓库根目录及所有子目录。若以后在子目录中增加更近的 `AGENTS.md`，则以离目标文件最近的说明为准；用户在对话中的明确要求始终优先。

## 项目概览

烽火AI 是一个本地优先的 AI 创作工作台，主要技术栈如下：

- 运行时与包管理：Bun
- Web：React 19、Vite、TanStack Router、TanStack Query、TanStack Table、Tailwind CSS
- API：Hono、`@hono/zod-openapi`
- API SDK：OpenAPI 文档配合 `@hey-api/openapi-ts` 自动生成
- 数据库：SQLite、Drizzle ORM、Drizzle Kit
- 异步任务：BullMQ、Redis、独立 Worker
- 校验与格式化：TypeScript strict、Biome
- 测试：Bun Test、Playwright（配置已存在，端到端用例按需放入 `tests/e2e/`）

系统由三个独立进程组成：

| 进程 | 入口 | 职责 |
| --- | --- | --- |
| Web | `web/main.tsx` | 页面、路由、交互与 API SDK 调用 |
| API Server | `server/index.ts` | Hono API、鉴权、持久化和 BullMQ 任务投递 |
| Worker | `worker/index.ts` | BullMQ 消费、长耗时任务执行和 SQLite 状态回写 |

API Server 不执行异步任务，Worker 不承载 HTTP API。两者通过 Redis 队列和同一个 SQLite 数据库协作。

## 渐进披露与文档路由

`AGENTS.md` 保存所有任务都需要遵守的工程规则；视觉设计细节单独保存在 `DESIGN.md`。不要在每个任务开始时默认加载整份设计文档，应先判断任务范围，再按下面的路由读取：

| 任务类型 | 需要读取的 `DESIGN.md` 内容 |
| --- | --- |
| Server、Worker、数据库、脚本或纯 API 改动 | 不需要读取，除非改动会影响用户可见界面 |
| 单个页面或组件的样式调整 | 先读 `Overview`、`Do's and Don'ts`，再读与改动相关的 `Colors`、`Typography`、`Layout`、`Shapes` 或 `Components` 小节 |
| 新页面、页面重构或视觉还原 | 读 `Overview` 至 `Do's and Don'ts`，并补读 `Responsive Behavior` 和 `Known Gaps` |
| 全局样式、设计 Token、共享 UI 基础组件 | 读取完整 `DESIGN.md`，同时核对 `web/styles/` 和已有通用组件 |
| 响应式、触控或跨尺寸问题 | 读 `Layout`、`Responsive Behavior` 以及目标组件对应小节 |

按需定位章节时优先使用：

```bash
rg -n '^#{2,3} ' DESIGN.md
```

设计实现规则：

- `DESIGN.md` 是视觉决策来源，不是运行时配置；实现前仍需检查现有组件和 CSS，避免重复建立 Token。
- 只读取当前任务需要的章节；当改动跨越颜色、字体、布局和多个组件时，再升级为完整阅读。
- 若现有页面与 `DESIGN.md` 不一致，以用户当前明确要求为最高优先级，并在交付说明中指出采用的设计依据。
- 新增可复用的视觉模式或修改全局设计语言时，同步更新 `DESIGN.md`；局部业务样式不应反向污染全局规范。
- 不要把 `DESIGN.md` 的大段内容复制回 `AGENTS.md`，保持工程规则与设计资料分层。

## 目录说明

- `web/`：前端应用。业务页面位于 `web/features/`，通用 UI 位于 `web/components/`。
- `web/api/generated/`：根据 OpenAPI 自动生成的客户端代码，禁止手工编辑。
- `server/`：HTTP API、账号、任务存储、模型 Provider、TOS 和 FFmpeg 集成。
- `server/db/`：Drizzle 数据库连接和 Schema。
- `worker/`：独立 Worker 入口和任务调度器。具体业务 Job 位于 `worker/jobs/`，不要放回 `server/`。
- `shared/`：跨进程的最小共享契约，目前包括 BullMQ 消息协议。
- `drizzle/`：Drizzle Kit 生成并由版本控制管理的数据库迁移。
- `DESIGN.md`：视觉语言、设计 Token、组件规范和响应式策略；仅按“渐进披露与文档路由”读取。
- `scripts/`：OpenAPI、SDK、模型、TOS 和 FFmpeg 的检查脚本。
- `tests/unit/`：Bun 单元测试。
- `tests/e2e/`：Playwright 配置期望的端到端测试目录；当前没有已提交用例，新增关键流程时在此补充。
- `openapi/`：导出的 OpenAPI 文档。
- `deploy/`：生产服务和 Nginx 配置。
- `.data/`、`artifacts/api-tests/`、`dist/`：本地产物，不要提交，也不要把它们当作源码修改。

## 环境准备与启动

安装依赖：

```bash
bun install
```

本地开发需要可访问的 Redis，默认地址为 `redis://127.0.0.1:6379`。

推荐分别启动 API/Web 与 Worker：

```bash
make run-server
# 另开终端
make run-worker
```

也可以一次启动全部进程：

```bash
make run-dev
```

默认地址：

- Web：`http://127.0.0.1:5173`
- API：`http://127.0.0.1:8787`
- OpenAPI：`http://127.0.0.1:8787/openapi.json`

生产模式需要先构建，并同时运行 Server 与 Worker：

```bash
bun run build
bun run start
# 另一个进程
bun run worker
```

不要让开发脚本或测试复用正在运行的生产数据库。需要隔离数据时，设置独立的 `YAOZUO_DATA_DIR` 或 `YAOZUO_DATABASE_URL`。

## 常用命令

```bash
make lint                 # Biome 格式检查和 lint
make test                 # 单元测试
make ci                   # lint + 单元测试
bun run typecheck         # TypeScript 类型检查
bun run build             # 类型检查并生成生产前端
bun run e2e               # 运行 tests/e2e/ 中的桌面端和 Tablet 测试
bun run api:spec          # 导出 openapi/openapi.json
bun run api:generate      # 生成 web/api/generated/
bun run db:generate       # 根据 Schema 生成 Drizzle migration
bun run db:check          # 校验 migration 一致性
bun run db:migrate        # 对配置的数据库执行 migration
```

需要真实外部能力时再运行：

```bash
bun run test:models
bun run test:seedance:multimodal
bun run test:video-analysis
bun run test:tos
bun run test:ffmpeg
```

这些命令可能消耗配额、访问外部服务或需要本机 FFmpeg，不应作为普通代码改动的默认验证步骤。

## 代码规范

- 使用 TypeScript 严格模式，不用 `any` 绕过类型问题。
- 遵循 Biome：2 空格缩进、双引号、分号、尾逗号、120 字符行宽。
- 优先使用已有路径别名 `@/*` 引用 `web/*`；服务端和 Worker 使用明确的相对路径。
- 复用现有组件、Schema、类型和工具函数，避免复制相同业务逻辑。
- 不要手工修改 `web/api/generated/`、`openapi/openapi.json` 或 `drizzle/meta/` 中的生成内容。
- 不要顺手格式化或重写与当前任务无关的文件。
- 保留用户工作区中已有且无关的修改；不要用破坏性 Git 命令清理工作树。

## 前端约束

- 涉及视觉或交互的任务，先按“渐进披露与文档路由”读取 `DESIGN.md` 的相关章节。
- 除非用户在当前任务中明确要求，否则不要新增副标题、description、tagline 或标题下方的解释性文案。页面、卡片和 Modal 标题默认只保留主标题；字段帮助、校验错误、风险警告和运行状态等必要功能信息不受此限制。
- 应用入口为 `web/main.tsx`，路由集中在 `web/app/router.tsx`。
- 项目名称和功能开放状态集中在 `web/app/config.ts`，不要在组件内另建一套功能开关。
- 新业务页面放入对应的 `web/features/<feature>/`，跨业务复用的组件放入 `web/components/`。
- 表格优先复用 `web/components/ui/data-table.tsx`，通过高度约束让表格内容区滚动，不要撑开父容器。
- 服务端数据优先通过生成的 API SDK 访问，不要在页面内散落手写请求路径和重复 DTO。
- 对媒体预览、上传和下载同时考虑图片、音频、视频 MIME 类型以及鉴权 URL。
- 修改交互和布局后，至少检查 `1440x900`；涉及响应式布局时同时检查 Playwright 配置中的 `1024x768`。

## API 与 SDK 约束

- API 路由和 OpenAPI Schema 使用 `@hono/zod-openapi` 在 `server/app.ts` 中定义。
- 对外字段、状态码或请求结构发生变化时，必须同步更新 Zod Schema、处理器和测试。
- API 契约更新后依次运行：

```bash
bun run api:spec
bun run api:generate
bun run typecheck
```

- 前端不得手工复制服务端 DTO；优先使用 `web/api/generated/` 导出的类型和 SDK。
- 新增受保护接口时必须经过现有 Bearer Token 鉴权中间件，只有明确的公共接口才可加入 `publicApiPaths`。
- 返回错误时沿用项目的结构化错误格式，包含 `code`、`message`、`retryable` 和 `requestId`。
- 新接口需要考虑用户资源隔离，服务端不得信任由前端提交的 owner/user ID。

## 数据库与迁移约束

- 所有业务数据库访问必须使用 Drizzle ORM；禁止在 Store、路由或 Worker 中新增 raw SQL CRUD。
- 表结构统一维护在 `server/db/schema.ts`，数据库初始化统一经过 `server/db/database.ts`。
- SQLite 连接层允许保留 WAL、busy timeout、foreign keys 等连接级 PRAGMA；业务代码不得直接操作底层 `bun:sqlite` client。
- 修改 Schema 后使用 `bun run db:generate` 生成 migration，再用 `bun run db:check` 校验。
- migration 文件一旦用于共享环境，不要重写历史；通过新增 migration 演进结构。
- Server 和 Worker 会并发访问 SQLite，事务、幂等键和状态迁移不能只按单进程假设设计。
- 测试使用临时数据库并在测试结束时关闭 Store、清理 SQLite、WAL 和 SHM 文件。
- 不要删除、覆盖或迁移 `.data/yaozuo.sqlite`，除非用户明确要求并已确认备份方案。

## 异步任务约束

- API Server 只通过 `server/jobs/bull-job-queue.ts` 发布或管理 BullMQ Job。
- `worker/job-processor.ts` 只负责调度、Handler 选择和维护任务；真实业务 Job 统一使用 `worker/jobs/job-*.ts` 命名。
- 每种独立 Job 流程实现 `worker/jobs/types.ts` 中的 `WorkerJobHandler`，并注册到 `worker/jobs/registry.ts`；专用 Handler 必须排在通用 fallback 前面。
- 每个公开模块的阶段、结果摘要和输出类型分别维护在 `worker/jobs/definitions/<module>.ts`，新增模块时必须同步注册到 `worker/jobs/definitions/index.ts`。
- Seedance 的上游提交、轮询、取消核对和暂存清理集中在 `worker/jobs/job-seedance-video.ts`，不要复制到各 Job Handler。
- Worker 启动和进程恢复逻辑放在 `worker/index.ts`。
- 队列消息必须使用 `shared/jobs/queue-contract.ts` 中的类型和 Job 名称；消息体保持最小化，持久状态以 SQLite 为准。
- 新任务必须考虑幂等提交、重试、取消、进程恢复、重复投递和 Worker 崩溃后的状态一致性。
- Worker 更新进度和结果时必须回写 SQLite，确保前端轮询或 SSE 能显示真实状态。
- 不要以进程内队列、内存 Map 或 Server 后台 Promise 替代 BullMQ；Server 与 Worker 是独立进程。

## 上传、文件和外部能力

- 浏览器素材上传采用前端直传 TOS，再把对象信息通过 API 写入素材库；不要让大文件正文经过 API Server 中转。
- TOS 使用私有 Bucket。读取地址应为短期签名 URL，不要将长期凭据或可永久访问的地址返回前端。
- 用户素材、任务生成物和文件夹必须保持 owner 隔离；生成物应落到用户选择的文件夹对应 TOS 前缀。
- 本地生成结果写入 `.data/results/`，上传暂存写入 `.data/uploads/`，不要提交这些文件。
- 能力不可用时必须显式标记 `real`、`local`、`mock` 或 `mixed` 来源，禁止静默切换 Provider、模型或 Mock。
- 真实模型、TOS 和 FFmpeg 能力以对应测试脚本的实测结果为准，不能只依据安装了 SDK 或存在环境变量判断可用。

## 配置与安全

- 从 `.env.example` 了解配置项；`.env` 含敏感信息，禁止读取后回显、提交或写入文档。
- 不得提交 JWT、Redis、模型 Provider 或 TOS 密钥。
- 生产模式必须配置至少 32 字符的随机 `JWT_SECRET`；开发环境临时密钥会在重启后使会话失效。
- 服务默认仅允许绑定 loopback 地址。不要为方便调试移除 `server/env.ts` 中的公网绑定保护。
- CORS、新增公开路由、上传限制、文件路径处理和媒体 Content-Type 属于安全敏感改动，需要增加针对性测试。
- 充值当前是明确的本地 Mock，不得在没有用户明确授权和支付安全设计的情况下接入真实扣款。

## 测试与交付标准

修改代码时，为变更补充或更新测试。按影响范围选择最小充分验证：

默认不要运行 E2E 测试。只有用户在当前任务中明确要求运行 E2E 时，才执行 `bun run e2e`；不得因为完整交付、关键流程或前端改动而自行追加 E2E，以免延长交付时间。

不要使用 `browser:control-in-app-browser` skill 做页面、交互或接口测试。该工具在本仓库不作为可用的验证手段；需要运行时验证时，优先使用项目单元测试、API 请求、类型检查和生产构建，确需浏览器验证则交由用户手动完成。

- 文档或纯样式：运行相关格式检查，必要时构建。
- 前端逻辑：相关单测、`bun run typecheck`、`bun run build`。
- API、Store 或 Worker：相关单测、`bun run typecheck`、`bun run build`。
- Schema 或迁移：相关数据库测试、`bun run db:check`、`bun run typecheck`。
- API 契约：重新生成 OpenAPI/SDK，并运行类型检查和相关测试。
- 跨页面关键流程：补充或更新 E2E 用例，但默认不运行；仅在用户明确要求时执行 `bun run e2e`。

完整交付基线为：

```bash
make ci
bun run typecheck
bun run build
```

E2E 不属于默认完整交付基线；用户明确要求时再单独运行。

若外部依赖、密钥、Redis、TOS、FFmpeg 或环境问题导致某项未运行，交付时必须明确说明未验证项及原因。不要把与本次改动无关的既有失败归因于当前修改，但也不要隐瞒。

## Agent 工作方式

1. 先读取相关代码、配置和测试，确认真实执行路径，不凭 UI 或 README 猜测实现。
2. 在修改前检查 `git status`，保留用户已有修改并限制改动范围。
3. 优先完成可逆、范围明确的实现；涉及删除数据、外部付费、生产发布或扩大权限时先征得用户确认。
4. 使用项目现有工具链，不额外引入库，除非现有能力确实不足且依赖收益明确。
5. 修改完成后运行与风险匹配的验证，并核对 `git diff` 没有无关变化。
6. 最终说明完成内容、关键文件、验证结果、已知限制和需要用户处理的外部条件。
