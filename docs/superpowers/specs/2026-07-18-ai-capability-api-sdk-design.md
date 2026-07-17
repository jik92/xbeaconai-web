# AI 能力 API 与前端 SDK 设计

## 目标

为曜作 AI 创作工作台建立一个运行于 Bun 的 Hono 服务端，安全读取模型供应商密钥，并为现有 12 个业务模块提供稳定、可观测的业务 API。服务端从路由定义生成 OpenAPI 文档，再通过脚本生成前端 TypeScript SDK、Zod 类型与 TanStack Query hooks。本轮必须让“创作工作流”和“AI 工具箱”的所有页面功能端到端可操作；真实 provider 缺 Key、权限或接口能力时，使用契约一致且明确标识的 Mock Provider 补齐执行链路。

所有声明为真实可用的模型能力必须完成真实请求验证。仅创建上游任务不算成功；异步任务必须到达成功终态，媒体结果必须可下载、类型正确且可解码。无法由当前 Aihubmix 网关支持的能力要形成明确缺口清单，以便补充文档和密钥；同时通过 Mock Provider 保证对应产品流程本轮仍可端到端完成。Mock 成功绝不能升级为真实能力验证成功。

## 范围

覆盖当前产品中的全部模块：

1. 爆款二创
2. 一键成片
3. 口播脚本
4. AI 创作
5. 视频分割
6. 素材理解
7. 视频混剪
8. 音色克隆
9. 视频修复
10. 字幕擦除
11. 画质增强
12. 爆款裂变

本阶段建立服务端 API、供应商适配层、OpenAPI 契约、生成式前端 SDK、真实能力验证工具和受控 Mock Provider，并将“创作工作流”和“AI 工具箱”全部 12 个模块页面接入生成 SDK。范围包含表单校验、文件上传、任务提交、SQLite 持久化、内存队列执行、查询/SSE 状态、取消、可重试失败、结果展示、预览或下载，以及模块定义的后续动作入口。人像库等资产页面只有在被工作流引用时才做必要接线，不扩展无关产品功能。

当前阶段是本地验证服务，只允许绑定 `127.0.0.1`，不作为可公开访问的生产服务。任何公网或局域网部署都必须先增加应用认证、用户/租户资源归属校验、CORS/CSRF 策略、请求限流、并发限制和费用配额；缺少这些控制时启动程序必须拒绝绑定非回环地址。

## 技术选择

### 服务端与契约

- Bun 作为服务端运行时。
- Hono 提供 HTTP 路由。
- `@hono/zod-openapi` 统一请求校验、响应定义和 OpenAPI 输出。
- Zod schema 是业务 API 数据结构的单一事实来源。
- `/openapi.json` 提供 OpenAPI 文档；文档也可通过脚本直接写入 `openapi/openapi.json`。

### 前端 SDK 生成

- `@hey-api/openapi-ts` 从 `openapi/openapi.json` 生成代码。
- 输出包含 TypeScript 类型、Fetch 客户端、Zod schema 和 TanStack Query hooks。
- 生成目录为 `src/api/generated/`，禁止手工修改。
- `bun run api:spec` 导出契约。
- `bun run api:generate` 生成 SDK。
- `bun run api:check` 重新生成并检查工作树是否存在契约漂移。

不采用 Hono RPC 作为主要前端契约。RPC 适合同仓类型共享，但会使前端依赖后端 `AppType` 和一致的 Hono 版本；OpenAPI 更适合生成独立 SDK、API 文档和跨语言客户端。

## 目录结构

```text
server/
  app.ts
  env.ts
  routes/
  schemas/
  providers/
    mock/
  jobs/
    sqlite-job-store.ts
    memory-job-queue.ts
  media/
  sdk-registry.ts
scripts/
  export-openapi.ts
  generate-api-client.ts
  test-capabilities.ts
  test-ffmpeg-sdk.ts
  test-model-sdks.ts
openapi/
  openapi.json
src/api/generated/
src/app/ui-feature-registry.ts
tests/
  contract/
  e2e-api/
artifacts/api-tests/
docs/
  api-capability-report.md
```

## 架构边界

### 业务路由

路由使用产品领域语言，不向前端暴露具体供应商的请求格式或模型特例。每个模块拥有独立路由和 schema，复用上传、任务、结果与错误结构。

### 供应商适配层

供应商适配层封装 Aihubmix 及后续补充的模型服务。能力接口包括：

- `generateText`
- `transcribeSpeech`
- `alignSubtitles`
- `analyzeImage`
- `analyzeVideo`
- `generateImage`
- `editImage`
- `generateVideo`
- `editVideo`
- `synthesizeSpeech`
- `cloneVoice`
- `restoreVideo`
- `eraseVideoRegion`
- `enhanceVideo`

每个 provider 显式声明能力和模型映射。业务代码只调用能力接口。供应商缺少某项能力时返回 `CAPABILITY_NOT_SUPPORTED`，不得伪造成功结果。

### Mock Provider 回退

Mock Provider 实现与真实 provider 完全相同的能力接口和结果 schema，仅在当前运行环境明确启用 `ALLOW_MOCK_FALLBACK` 且对应真实能力终态为 `unauthorized`、`unsupported`、`failed` 或缺少配置时参与路由选择。真实能力已验证可用时默认优先真实 provider；真实调用过程中的临时超时、限流或内容拒绝不得静默切换 Mock，除非调用方在创建任务时明确选择允许 fallback，并在任务结果中记录切换原因。

Mock 必须真实经过上传、SQLite 任务、内存队列、进度、SSE、结果存储和下载链路，不能由前端定时器伪造完成。媒体类 Mock 生成可解码的小型确定性图片、音频或视频；文本类 Mock 返回符合业务 schema 的确定性内容。Mock 任务保留合理的多阶段进度、可配置失败场景、取消点和批量部分成功场景，以覆盖页面状态交互。

每个任务持久化逐阶段和逐产物 provenance；任务级执行模式仅为派生摘要：`real | local | mock | mixed`。每条阶段记录包含稳定 stage ID、原子能力、`executionMode: "real" | "local" | "mock"`、安全的 provider/implementation 标识、真实模型（适用时）、fallback reason、输入/输出产物 ID、时间和配置指纹。每个结果产物保留完整 lineage，能够追溯经过的真实、Mock 和本地阶段。

任务行显示派生摘要；结果抽屉、具体预览和下载元数据必须显示该产物自身的逐阶段来源，不能用任务摘要掩盖混合链路。Mock 媒体加入不影响解码的可见或元数据标识，避免被误当作生产生成物。真实验证率只能从 `executionMode: "real"` 的阶段证据计算，`mixed` 任务不能整体计为真实成功。生产模式默认禁止 Mock；若显式启用，健康检查和页面顶部必须显示醒目警告。

任务创建时根据能力记录生成并持久化不可变执行计划：每个原子阶段选定 implementation/provider/model、候选优先级、是否允许 fallback、选择原因、能力与配置指纹，以及预计是否计费。候选选择按显式配置优先级和稳定 ID 排序确定，不依赖注册顺序。排队、重启和租约恢复复用原计划，配置或验证记录变化不能静默改变已接受任务的执行模式。

普通 retry 复用原执行计划和未失效的上游任务 ID。若用户希望重新选择 provider、从 Mock 切换真实或从真实切换 Mock，必须通过明确的“按当前能力重新创建任务”动作生成新任务，并在提交前展示可能的执行模式和计费变化。自动重试不得从 Mock 切换到计费真实能力，也不得反向切换。测试覆盖排队期间配置变化、重启恢复、普通重试和显式重新规划。

### 本地媒体层

视频切分、封装、抽帧、拼接、字幕烧录、音画对齐、元数据读取和部分基础混剪优先由 FFmpeg 等本地媒体工具实现。镜头边界、字幕区域跟踪等算法能力必须单独声明输入输出和实际实现，不得笼统归类为 FFmpeg。模型能力和确定性媒体处理分别报告，避免将本地处理错误归因于模型接口。

### 任务系统

耗时操作统一使用异步任务模型。初始实现固定使用 SQLite 作为持久化事实来源，使用进程内内存队列负责调度和执行；任务存储与执行器通过接口隔离，便于后续替换为外部数据库和队列。SQLite 启用 WAL、busy timeout 和迁移版本管理。任务创建先在一个事务中持久化为 `queued`，提交成功后再放入内存队列；入队失败时由恢复扫描器重新入队，不能丢失已接受任务。

任务领取使用 SQLite 条件更新和租约；同一任务任一时刻最多由一个 worker 执行。启动时扫描 `queued` 与租约过期的 `processing` 任务并恢复到内存队列。涉及上游计费任务时必须先按持久化的上游任务 ID 恢复查询，不得重新创建。内存队列有全局并发上限和按能力并发上限，并实现有界容量和背压；队列满时任务仍可安全持久化并等待后续扫描，不得无限占用内存。

幂等键的作用域是“本地调用方 + 路由 + 请求内容摘要”，至少保留 24 小时。同一键和相同内容返回原任务；同一键但内容不同返回 `409`。每类任务定义最大执行时长、最大尝试次数和并发上限。进度限制为 0 至 100 且正常执行时单调递增。取消是尽力而为：若上游无法取消，则本地停止后续阶段并记录上游状态；已进入终态的任务返回 `409`。只有标记为可重试的失败任务允许重试。

`partially_succeeded` 仅用于批量任务，结果必须同时包含成功项和失败项，每个失败项使用统一 `ApiError`；单项任务不得返回部分成功。

页面任务状态以 SQLite 中的任务记录为准。任务状态或进度更新在事务提交后发布 SSE 事件；页面首次加载和断线恢复先查询 `GET /api/jobs/{jobId}`，再订阅事件，避免只依赖易丢失的内存事件。现有任务中心需要显示排队、处理中、进度、阶段、成功、部分成功、失败和取消状态，并支持刷新后恢复。

任务状态为：

```text
queued -> processing -> succeeded
                     -> partially_succeeded
                     -> failed
queued/processing    -> cancelled
```

## API 设计

### 公共接口

```text
POST /api/uploads
GET  /api/capabilities
GET  /api/models
GET  /api/health
GET  /api/jobs/{jobId}
POST /api/jobs/{jobId}/cancel
POST /api/jobs/{jobId}/retry
GET  /api/jobs/{jobId}/events
GET  /api/jobs/{jobId}/result
GET  /openapi.json
```

### 模块任务接口

每个模块通过 `POST /api/{module}/jobs` 创建任务，其中 `{module}` 使用稳定的英文标识：

```text
video-remix
video-create
ad-script
ai-generate
video-cut
media-understand
video-mashup
voice-clone
video-renewal
subtitle-erase
video-enhancement
kickart
```

短文本任务可以在服务端快速完成，但仍返回统一任务对象，避免前端为同步和异步响应维护两套流程。

### 任务响应

```ts
type JobStatus =
  | "queued"
  | "processing"
  | "succeeded"
  | "partially_succeeded"
  | "failed"
  | "cancelled"

interface Job<T = unknown> {
  id: string
  module: string
  status: JobStatus
  progress: number
  stage?: string
  result?: T
  error?: ApiError
  createdAt: string
  updatedAt: string
}
```

具体模块的成功响应使用具名 schema，OpenAPI 中不得以 `unknown` 代替实际结果。公共泛型仅用于说明统一包络。

创建任务返回 `202`。即时校验和鉴权失败不创建任务，直接使用对应 HTTP 错误；任务创建后的处理失败记录在任务对象中。API 按场景完整描述 `400/401/403/404/409/413/415/422/429/5xx` 响应、稳定 `operationId` 和实际 content type，不允许无类型的 `additionalProperties`。

### 上传与媒体结果

- 上传接口使用 `multipart/form-data`。
- 服务端校验文件大小、MIME 和可解码性，不信任客户端文件名。
- 上传成功返回稳定的媒体资源 ID，不向业务路由传递任意本地路径。
- 结果接口返回受控下载 URL 或媒体响应，不暴露供应商私有 URL。
- 临时文件和测试产物使用明确的生命周期与清理策略。

本地原型使用工作目录外的私有数据目录，文件权限仅限当前用户。资源 ID 使用不可预测值，所有解析后的路径必须经过目录包含校验。单文件、单请求和总磁盘配额均通过配置给出；超过配额时在写入前拒绝并返回 `413` 或 `503`。上传与中间文件默认保留 24 小时，成功结果默认保留 7 天，定时清理和启动时清理均需幂等。任务引用的媒体在任务运行期间不得删除；过期结果返回 `410`。

服务必须通过魔数嗅探和实际解码验证媒体，覆盖伪造 MIME、路径穿越文件名、超大 multipart 和异常压缩/解码资源。客户端不得提交任意远程 URL 供服务端抓取。

供应商结果下载是独立安全边界：优先使用 provider 的明确主机 allowlist；解析 DNS 后拒绝回环、私网、链路本地和云元数据地址；限制重定向次数，且每次重定向都重新执行策略；限制连接/总超时、响应字节数和 content type；下载后先嗅探与解码，再进入持久存储。签名 URL 仅以脱敏形式记录。

### 进度更新

- 普通状态查询通过 `GET /api/jobs/{jobId}`。
- 实时进度使用 SSE：`GET /api/jobs/{jobId}/events`。
- SDK 生成器负责普通 REST 调用；SSE 使用一个薄的手写客户端包装，因为 OpenAPI 对事件流客户端生成的支持不一致。
- SSE 使用 `text/event-stream`，定义 `job.updated`、`job.completed` 和心跳事件；事件包含递增 ID，客户端通过 `Last-Event-ID` 恢复，终态后关闭连接。

## 模块能力映射

| 模块 | 主要能力 | 执行形态 |
|---|---|---|
| 爆款二创 | 视频理解、文本改写、分镜、配音、视频生成与合成 | 异步工作流 |
| 一键成片 | 脚本、素材匹配、配音、字幕、合成 | 异步工作流 |
| 口播脚本 | 文本生成与改写 | 统一任务 |
| AI 创作 | 文本、图片、视频生成 | 统一任务 |
| 视频分割 | 媒体探测与本地切分 | 异步媒体任务 |
| 素材理解 | 图片/视频理解、时间轴标签 | 异步模型任务 |
| 视频混剪 | 素材编排与本地批量渲染 | 异步批任务 |
| 音色克隆 | 样本验证、训练、试听 | 异步供应商任务 |
| 视频修复 | 问题检测与修复 | 异步供应商任务 |
| 字幕擦除 | 区域追踪、修复与导出 | 异步供应商任务 |
| 画质增强 | 超分辨率、去噪和补帧 | 异步供应商任务 |
| 爆款裂变 | 文本变量、镜头编排与批量渲染 | 异步批任务 |

## 能力发现

`GET /api/capabilities` 是运行时可执行能力接口，返回 `executionMode`。真实和本地项分别来自 `verified` 与 `local`；仅当允许 Mock fallback 时，缺口能力额外返回 `mock` 执行项。Mock 条目不能带真实模型名或 `verified` 状态。完整上游诊断状态只写入本地能力报告，不通过公开业务 API 暴露。模型列表接口返回项目允许使用的真实模型和单独分组的 Mock 选项，而不是不加筛选地转发供应商完整列表。

验证结果分为：

- `verified`：真实调用与结果校验通过。
- `unauthorized`：接口存在，但当前 Key 或账户无权使用。
- `unsupported`：供应商未提供该能力。
- `failed`：接口存在但请求或结果校验失败。
- `local`：由本地媒体工具实现，不依赖模型接口。
- `unverified`：尚未完成真实验证，不得在生产能力列表中启用。

验证记录绑定 provider、Base URL、密钥的不可逆短指纹、模型、关键配置与代码版本。密钥或配置指纹变化后旧记录立即失效；超过可配置有效期的记录不得启用能力。启动时若不存在当前环境的有效记录，能力保持关闭，直到显式执行真实验证。

### 强制能力矩阵

能力报告必须为下面列出的每个原子能力建立记录，不允许省略或保持 `unverified` 作为最终结果。记录主键是 `(module, atomicCapability, implementation, provider, model)`；每条记录必须具有且仅具有一个终态：`verified`、`unauthorized`、`unsupported`、`failed` 或 `local`。同一模块内的每个逗号分隔项都是独立原子能力，不得合并状态。

| 模块 | 必测能力 |
|---|---|
| 爆款二创 | 上传、媒体探测、视频理解、语音转写、文本改写、分镜生成、语音合成、视频生成、视频编辑、音视频合成 |
| 一键成片 | 文本生成、素材理解、素材匹配、图片生成、视频生成、语音合成、字幕对齐、音视频合成 |
| 口播脚本 | 文本生成、结构化输出、文本改写 |
| AI 创作 | 文本生成、图像理解、图片生成、图片编辑、视频生成、视频编辑 |
| 视频分割 | 媒体探测、按固定时长切分、镜头边界切分、静音切分 |
| 素材理解 | 图片理解、视频理解、语音转写、时间轴标签 |
| 视频混剪 | 音画探测、素材编排、字幕/配音对齐、批量渲染 |
| 音色克隆 | 样本验证、克隆训练、克隆音色合成、试听媒体校验 |
| 视频修复 | 问题检测、视频去噪、视频防抖、缺损修复、结果媒体校验 |
| 字幕擦除 | 区域输入、区域跟踪、逐帧擦除、背景补全、结果媒体校验 |
| 画质增强 | 超分辨率、去噪、人脸增强、补帧、结果校验 |
| 爆款裂变 | 文本变量、镜头重排、批量渲染、部分成功模型 |

每条记录包含 run ID、时间、环境/配置指纹、provider、endpoint、模型、本地工具版本、请求摘要、终态、耗时、结果校验摘要和证据路径。非 `verified/local` 结果必须注明缺少的文档、权限、模型或 Key。

真实能力矩阵之外维护一份 Mock 覆盖矩阵，主键为 `(module, atomicCapability, mockImplementation)`。每个真实缺口必须恰好映射到一个可执行 Mock，且 Mock 合约测试、媒体校验和模块端到端测试通过。报告同时展示“真实能力状态”和“本轮产品执行模式”，禁止用 Mock 覆盖或隐藏真实缺口。

表中的能力全部是“且”关系，都必须独立探测；不存在以其中一个成功替代另一个的“或”关系。如果某一业务配置确实允许替代分支，分支仍分别记录，业务能力是否可用再由明确的组合规则计算。

## 真实测试策略

### 测试素材

生成无版权、无隐私风险的最小样本：

- 一段中文商品口播文本。
- 一张包含人物、商品和中文文字的测试图片。
- 一段 3 至 5 秒、包含运动画面、语音和硬字幕的 MP4。
- 一段 5 至 10 秒的单人干净语音 WAV。
- 视频的低清和轻噪点变体。

样本进入版本控制前检查体积；过大的二进制产物只记录生成脚本，不提交文件。

### 三层验证

1. 供应商探测：直接使用 `.env` 中的 Base URL 和 Key 获取模型并真实调用相关接口。
2. Provider 合约：所有适配器运行相同能力测试，验证统一输入输出和错误映射。
3. Hono 端到端：通过正式业务 API 上传、创建任务、轮询、下载并验证结果，同时用生成 SDK 发起至少一轮调用。

所有路径都必须通过 12 个模块各自的正式路由完成端到端验证；不能只验证底层 provider 或只调用一个示例路由。真实能力存在时走真实路径；缺 Key、权限或接口能力时走明确标识的 Mock 路径。关闭 Mock fallback 后，缺口路由必须真实返回确定性的 `CAPABILITY_NOT_SUPPORTED`，并与能力报告一致。

### 页面端到端验证

每个模块必须使用浏览器自动化从真实页面完成至少一条成功主路径：填写所有必填字段、上传适用的真实测试媒体、提交任务、观察 queued/processing 及阶段进度、等待终态、刷新页面验证恢复、打开结果并执行适用的预览或下载动作。所有模块还需覆盖表单校验；共享任务系统覆盖取消、失败重试、SSE 断线恢复和批量部分成功，无需在每个模块重复相同负向场景。

爆款二创的多阶段页面必须依次完成上传配置、AI 解析、提示词校对、分镜校对和合并成片；不能直接跳到最终 Mock 结果。一键成片和其余工具必须按各自配置定义生成可消费的结果。页面不得再以 `曜作 Mock Engine` 或前端本地计时器作为隐式成功来源；所有结果必须来自 Hono API 任务。

`src/app/ui-feature-registry.ts` 是“所有页面功能”的机器可读单一清单，键为 `(module, featureOrMode, userAction)`。每条记录包含页面路径、可见控件或动作的稳定 ID、适用条件、所需输入（含是否需要上传）、预期 API operationId、工作流阶段、结果消费行为、真实/本地/Mock fallback 规则和浏览器 E2E case ID。清单覆盖模式切换、tab、条件字段、上传/资产选择、提交、编辑/校对、预览、复制、下载/导出、重试、取消、重新生成、后续导航和所有结果动作。

每种不同创作模式和结果类型至少有一条成功页面路径；每个可见动作至少有一次浏览器交互与断言，但共享动作无需重复触发昂贵生成。创作工作流和 AI 工具箱 12 个模块中当前存在的所有可见功能和动作均不得以 disabled、coming-soon 或“明确排除”代替实现；缺少真实能力时必须通过 Mock fallback 完成行为。只有两个产品区之外的控件，或用户明确批准从本轮产品范围删除的功能，才能进入独立排除清单；排除项不计入覆盖等式，也不能用于满足验收。构建和测试扫描实际路由配置、字段、按钮/动作稳定 ID 与注册表，强制 `registered in-scope actions == wired actions == exercised/reported actions`；发现未登记控件、无 API/本地行为动作或缺少测试即失败。

### SDK 与脚本真实验证

模型 SDK 脚本必须覆盖文本生成、图片生成、视频生成和音频生成。每类能力至少包含一个可重复运行的独立脚本，真实读取服务端环境配置、调用实际 endpoint、等待异步任务终态并验证结果；不得用 Mock、静态 fixture 或仅做类型检查代替真实调用。若同一能力存在多个准备启用的 provider/model 组合，每个组合都生成独立原子记录并实测。无法成功的组合必须进入缺口报告，而不是从脚本或报告中删除。

FFmpeg SDK/包装脚本必须覆盖项目实际使用的全部确定性媒体能力：媒体探测、抽帧、转码、封装转换、固定时长切分、静音切分、镜头切分实现、音频提取、音视频合成、拼接、裁剪/缩放、字幕烧录、音画对齐、基础去噪以及测试样本生成。每个脚本都对真实媒体执行，并验证退出码、输出存在性、媒体 checksum、编码/轨道/时长/分辨率等关键属性。依赖额外滤镜或本机构建不支持的功能必须报告具体 FFmpeg 版本、编译能力缺口和替代方案。

`scripts/test-model-sdks.ts` 作为模型脚本总入口，`scripts/test-ffmpeg-sdk.ts` 作为 FFmpeg 总入口；二者支持按能力筛选，但全量模式必须遍历所有登记项并生成结构化证据。

`server/sdk-registry.ts` 是模型 SDK 和 FFmpeg 包装脚本的机器可读单一注册表。每个条目至少包含稳定 `id`、实现文件路径、`kind`、原子能力、provider/model 或所需 FFmpeg feature、`enabled`、`required` 和测试适配器 ID。模型 provider 声明、模型映射和生产媒体包装导出都必须能与注册表双向审计。

Mock provider 也进入同一注册表，但使用独立 `kind: "mock"`，不得计入真实 SDK 的 `verified` 覆盖率。注册表审计额外要求每个真实缺口都有 Mock 映射，并且每个 Mock 都被至少一个模块工作流引用，防止无效或遗漏的 fallback。

两个总入口只能从注册表枚举测试项，不维护独立手工清单。全量运行必须为每个注册条目产生一个终态证据记录，并在以下任一情况失败：ID 重复、实现文件缺失、测试适配器缺失、生产 wrapper/provider 映射未登记、登记实现未导出、尝试记录缺失或报告记录缺失。最终执行覆盖断言为 `registered == attempted == reported`；`unsupported` 等非成功终态可以计入 attempted/reported，但不得被静默跳过。即使多个脚本实现同一能力，也必须分别登记、分别执行和分别报告。

### 成功条件

- 同步接口收到有效、符合 schema 的成功响应。
- 异步接口轮询到 `succeeded`；只取得任务 ID 不算成功。
- 图片、音频和视频能够下载，MIME 与声明一致，文件大小非零。
- 图片可解码；音视频通过媒体探测并具有合理的时长、轨道和编码信息。
- 供应商返回 URL 时，必须实际下载结果，不以 URL 存在作为成功依据。
- 每个原子能力至少执行一次真实探测尝试。`verified` 必须至少有一次最小成本成功请求并完成全部结果校验；`local` 必须实际执行确定性本地测试；`unauthorized`、`unsupported` 和 `failed` 必须保留真实探测证据，或在无法安全发起请求时提供供应商的确定性文档证据，并注明所需 Key、权限、文档或修复动作。

### 成本控制

使用最小输入、最低合理分辨率和最短允许时长。视频生成、音色克隆与批量生成中标记为 `verified` 的能力各执行一个最小成功样本；`unsupported`、`unauthorized` 和 `failed` 按真实探测证据规则记录，不强求不可能的成功结果。失败重试有上限，且创建类请求携带幂等键；避免因网络错误产生重复计费任务。

真实计费测试使用显式命令和 profile，不进入普通单元测试或默认 CI。运行前要求配置单请求、总请求、总费用估算和总时长上限；到达任一上限立即停止创建新任务。命令退出码区分“矩阵完整但存在 unsupported/unauthorized”与“测试器异常/记录不完整”。测试输入、声音和上游响应产物默认被 Git 忽略并受保留期控制。

## 错误模型

统一错误码：

- `AUTHENTICATION_FAILED`
- `MODEL_NOT_AVAILABLE`
- `CAPABILITY_NOT_SUPPORTED`
- `INVALID_MEDIA`
- `CONTENT_REJECTED`
- `RATE_LIMITED`
- `PROVIDER_TIMEOUT`
- `PROVIDER_ERROR`
- `PROCESSING_FAILED`
- `RESULT_INVALID`

`ApiError` 包含稳定错误码、适合用户展示的消息、是否可重试、provider 和脱敏后的上游请求 ID。不得返回密钥、完整上游响应、内部堆栈、本地文件路径或敏感输入。

公开 `ApiError` 精确定义为 `code`、`message`、`retryable`、`requestId` 和可选字段级 `details`；provider 与上游请求 ID 只进入脱敏内部日志和本地诊断报告。每个请求生成 correlation ID，并贯穿路由、任务、provider 和媒体处理日志。错误码到 HTTP 状态的映射写入 OpenAPI；任务创建后的失败保持任务查询 HTTP `200`，由任务 `status/error` 表达。

限流和临时错误使用带抖动的指数退避。校验错误、内容拒绝和不支持能力不自动重试。任务重试记录父任务 ID，并防止同一幂等键重复创建计费任务。

## 安全与配置

- `OPENAI_KEY` 和供应商密钥只在服务端读取。
- Vite 客户端不读取或注入供应商密钥。
- `.env.example` 只列变量名和用途。
- 日志和测试证据统一脱敏 Authorization、Cookie、签名 URL 与敏感输入。
- OpenAPI 文档不包含真实服务端密钥或测试凭证。
- 上传接口配置体积限制、媒体类型白名单与文件名清洗。
- 当前本地模式只接受回环来源，并设置严格 CORS；生产模式必须使用 OpenAPI security scheme、短期应用令牌或用户会话，并在上传、任务、事件和下载接口执行资源所有权校验。
- 本地模式每次启动生成随机应用令牌，所有上传、任务创建、取消、重试及其他变更或高成本接口都必须校验该令牌；它不是供应商 Key。Vite 开发客户端通过只存在于当前进程/会话的启动握手或开发代理获得令牌，不写入源码、生成 SDK、`.env` 或持久存储。请求带 `Origin` 时必须严格匹配允许来源，缺失或无效令牌均拒绝执行。
- 生产资源 ID 不可枚举，下载链接短期有效且绑定资源所有者。
- 对上传、任务创建和高成本操作分别设置速率、并发和费用配额；负向端到端测试覆盖未认证、越权读取/取消/下载和超额请求。

## 产物与报告

- `docs/api-capability-report.md`：12 个模块逐项测试状态、模型、provider、验证时间、缺口和下一步所需文档/Key。
- `artifacts/api-tests/`：脱敏请求摘要、响应摘要、任务终态和媒体探测结果。
- `openapi/openapi.json`：确定性生成的 API 契约。
- `src/api/generated/`：确定性生成的前端 SDK。
- `scripts/test-capabilities.ts`：可重复运行的真实测试入口。
- `scripts/test-model-sdks.ts`：文本、图片、视频和音频模型 SDK 的真实测试总入口。
- `scripts/test-ffmpeg-sdk.ts`：所有项目内 FFmpeg 包装能力的真实媒体测试总入口。
- `scripts/generate-api-client.ts`：客户端生成入口。

能力报告为每项能力并列展示 `realStatus`、`missingRequirement`、`fallbackAvailable`、`fallbackImplementation` 和本轮端到端逐阶段实际使用的 provenance。页面端到端报告逐模块记录浏览器用例、任务 ID、冻结执行计划、阶段/产物来源、派生总体模式、终态、结果文件校验和截图/trace 路径。

测试证据采用带版本号的 JSON schema，至少包含 run ID、配置指纹、开始/结束时间、请求摘要、响应摘要、文件 checksum、媒体探测输出和错误分类。日志是结构化 JSON，并对 Authorization、Cookie、签名查询参数和输入内容执行统一脱敏。

## 验收标准

1. Bun 可以启动 Hono 服务，且健康检查与 OpenAPI 文档可访问。
2. 12 个模块都有具名请求和响应 schema，并出现在 OpenAPI 文档中；所有成功和错误状态、multipart、二进制结果和 SSE content type 均有契约。
3. 一条命令可以确定性地重新生成前端 SDK；生成器与配置锁定版本，干净重生成无差异，生成代码通过 TypeScript 检查和运行时 smoke test。
4. 前端不包含任何供应商密钥。
5. 能力报告涵盖所有模块，且每项均有明确状态和证据。
6. 强制能力矩阵中的每个 `(module, atomicCapability, implementation, provider, model)` 记录都有且仅有一个允许的终态、证据和时间；最终报告不得残留 `unverified`。所有标记为 `verified/local` 的能力都完成真实端到端测试。
7. 异步能力验证包含终态与实际结果下载检查。
8. 当前供应商不支持或无权限的能力被明确列出，并注明需要补充的文档或 Key。
9. 12 个模块的全部主路径均通过页面、生成 SDK 和各自业务路由完成端到端验证；真实缺口由明确标识的 Mock Provider 补齐。关闭 Mock 后，缺口路径真实返回与报告一致的不支持错误。
10. 单元测试、Provider 合约测试、API 端到端测试和现有前端类型检查通过。
11. 重启恢复、重复幂等请求、取消竞争、重试限制和批量部分成功均有自动测试。
12. MIME 欺骗、路径穿越、超大上传、过期结果、清理、恶意 URL、私网/元数据地址和越界重定向均有负向测试。
13. 本地模式无法绑定非回环地址；生产模式缺少认证、所有权、限流和费用配额配置时拒绝启动。
14. 跨来源请求或缺少/伪造本地应用令牌的写入和高成本请求均在创建资源或调用供应商之前被拒绝，并有负向端到端测试。
15. 文本生成、图片生成、视频生成和音频生成的每个登记 provider/model SDK 组合都完成真实测试并产生原子证据；失败组合明确进入缺口报告。
16. 项目登记的每个 FFmpeg 包装能力均对真实媒体执行并验证输出属性；本机缺少的滤镜或编码能力有明确证据和替代方案。
17. SQLite 是任务状态的持久化事实来源，内存队列支持异步提交、并发限制、背压和启动恢复；自动测试覆盖数据库提交后入队失败、进程重启、租约恢复和重复领取。
18. 页面任务中心通过查询与 SSE 显示任务状态、阶段和进度，刷新及 SSE 断线重连后状态仍正确。
19. 模型与 FFmpeg SDK 注册表是唯一枚举来源；全量测试强制满足 `registered == attempted == reported`，并能发现重复、缺失、未登记或未导出的生产脚本与映射。
20. “创作工作流”和“AI 工具箱”全部页面不再依赖前端本地 Mock 计时器；每个模块至少一条浏览器成功主路径经过上传（适用时）、Hono、SQLite、内存队列、状态更新和结果消费。
21. 每个真实能力缺口都具有唯一 Mock 映射；Mock 结果在 API、页面、报告和媒体中可识别，且不会计入真实验证成功率。
22. 共享端到端测试覆盖 Mock 多阶段进度、取消、失败重试、批量部分成功和 SSE 断线恢复；生产模式默认禁用 Mock，并在显式启用时显示警告。
23. UI 功能注册表覆盖两个产品区内所有可见模式、控件和动作，并强制满足 `registered in-scope actions == wired actions == exercised/reported actions`；每种创作模式和结果类型有成功路径，每个现有动作都有真实交互断言，不能用 disabled、coming-soon 或普通排除状态替代。
24. 混合工作流持久化逐阶段和逐产物 provenance，页面、刷新恢复、重试、报告及下载元数据均保持一致；真实验证率不计入 Mock 和 local 阶段。
25. 任务创建时冻结确定性执行计划；排队期间配置变化、重启和普通重试不改变计划，只有显式重新创建任务才能重规划或改变计费/Mock 模式。

## 后续实施顺序

1. 建立 Hono、环境配置、错误模型和 OpenAPI 导出。
2. 建立 Hey API 生成流程与最小端到端示例。
3. 探测 Aihubmix 的模型与接口，并形成初始能力矩阵。
4. 实现 SQLite 任务存储、内存队列、公共上传、任务、SSE 与结果机制。
5. 按依赖顺序实现文本、视觉、图片、音频、视频 provider。
6. 实现本地媒体处理能力。
7. 建立受控 Mock Provider，并为每个真实能力缺口建立唯一 fallback 映射。
8. 为 12 个模块建立业务编排路由。
9. 使用生成 SDK 将创作工作流和 AI 工具箱全部页面接到业务 API、SQLite 任务与 SSE 状态。
10. 用真实样本执行全量 provider/FFmpeg 验证，并用真实或明确 Mock 路径执行全部页面端到端测试和完成报告。
