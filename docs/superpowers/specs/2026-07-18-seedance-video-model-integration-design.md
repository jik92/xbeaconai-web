# Seedance 视频模型正式接入设计

## 目标

将 AIHubMix 提供的三款字节 Seedance 2.0 视频模型正式接入曜作工作台，完全移除 Wan 新任务执行路径，并让所有最终生成视频的功能都可以显式选择模型。

本次接入的模型为：

| 展示名称 | 模型 ID | 定位与介绍 |
| --- | --- | --- |
| 字节 Seedance 2.0 多模态参考 | `doubao-seedance-2-0-260128` | 音视图文均可参考，强调超强参考一致性和极致拟真的视听稳定性。 |
| 字节 Seedance 2.0 Mini | `doubao-seedance-2-0-mini-260615` | 音视图文均可参考，面向高性价比、高频和规模化视频生成。 |
| 字节 Seedance 2.0 Fast | `doubao-seedance-2-0-fast-260128` | 音视图文均可参考，生成速度更快，并继承 Seedance 2.0 的核心优势。默认选择。 |

## 已验证事实

- AIHubMix 实时模型目录可以查询到上述三个精确模型 ID，类型均为视频。Mini 当前未列在静态视频文档的 Seedance 参数表中，因此不能从 Standard/Fast 推定其参数；实施前必须保存带时间戳和非敏感配置指纹的实时目录证据，并对 Mini 单独探测。
- AIHubMix 视频生成文档说明 Seedance 2.0 通过 `/v1/videos` 创建任务，并通过 `extra_body.content` 接收图片、视频和音频参考。
- Seedance 使用 `extra_body.ratio`、`extra_body.duration`、`generate_audio` 和 `watermark` 等模型级参数。当前 Wan 适配器固定发送的 `seconds: "2"` 与 `size: "1280x720"` 不能直接复用。
- `doubao-seedance-2-0-fast-260128` 已完成真实创建、轮询、下载和 FFprobe 验证；测试产物为 H.264/AAC 可播放视频。
- 火山引擎 TOS 官方地域表确认上海地域为 `cn-shanghai`，公网 Endpoint 为 `tos-cn-shanghai.volces.com`；本项目使用私有 Bucket `xbeacon` 作为 Seedance 参考素材中转。

## 范围

### 包含

- 三个 Seedance 模型的统一元数据目录、白名单和模型介绍。
- AIHubMix Seedance 专用请求适配、多模态引用组装、轮询与下载。
- 基于 `@volcengine/tos-sdk` 的全局 `ossutils`，负责私有上传、短期签名读取 URL、删除和过期清理。
- 所有最终输出视频的创作工作流显示准确的生成引擎状态；真正调用视频生成的模式增加模型选择，默认 Seedance 2.0 Fast。
- 后端执行计划、任务来源和结果中记录准确的 Provider、模型 ID和执行模式。
- 删除 Wan 的模型注册、默认选择和新任务执行分支。
- 三个模型分别进行真实接口测试并生成独立证据。
- OpenAPI TypeScript SDK、单元测试和端到端测试更新。

### 不包含

- 自动在 Seedance 模型之间切换。
- Seedance 失败后自动降级 Wan 或 Mock。
- 本轮新增独立的模型管理后台、计费系统或供应商路由平台。
- 删除历史任务中已有的 Wan 来源记录。

## 架构

### 视频模型目录

新增集中式视频模型配置模块。每个模型条目必须包含：

- 精确模型 ID。
- 中文展示名称、简短介绍和定位标签。
- 支持的参考输入类型：文本、图片、视频、音频。
- 默认比例、时长、是否生成音频、是否添加水印。
- Provider、测试适配器 ID和启用状态。

前端、任务校验、执行计划和 SDK 注册表必须引用同一目录，避免模型名称和能力在多个文件中漂移。默认模型常量为 `doubao-seedance-2-0-fast-260128`。

### Provider 边界

`AihubmixClient` 保留通用的鉴权、错误截断、任务查询和内容下载能力，新增 Seedance 专用创建参数。输入类型必须完整定义，禁止使用未约束的对象：

```ts
type SeedanceReference =
  | { kind: "image"; url: string }
  | { kind: "video"; url: string }
  | { kind: "audio"; url: string };

interface SeedanceVideoInput {
  model: SeedanceModelId;
  prompt: string;
  resolution: "480p" | "720p";
  ratio: "adaptive" | "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9";
  duration: -1 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;
  generateAudio: boolean;
  watermark: boolean;
  references: SeedanceReference[];
}
```

Provider 发送的准确 Wire Schema 为：

```json
{
  "model": "doubao-seedance-2-0-fast-260128",
  "prompt": "用户提示词",
  "extra_body": {
    "content": [
      { "type": "image_url", "image_url": { "url": "<signed-url>" }, "role": "reference_image" },
      { "type": "video_url", "video_url": { "url": "<signed-url>" }, "role": "reference_video" },
      { "type": "audio_url", "audio_url": { "url": "<signed-url>" }, "role": "reference_audio" }
    ],
    "resolution": "720p",
    "ratio": "16:9",
    "duration": 5,
    "generate_audio": true,
    "watermark": false
  }
}
```

字段映射必须固定为 `generateAudio → extra_body.generate_audio`，其余 `resolution`、`ratio`、`duration`、`watermark` 均位于 `extra_body`。无参考素材时省略 `content`，不得发送空的无类型对象。

参考输入映射为：

- 图片：`type: "image_url"`、`role: "reference_image"`。
- 视频：`type: "video_url"`、`role: "reference_video"`。
- 音频：`type: "audio_url"`、`role: "reference_audio"`。

在产生计费请求前进行模型级参数校验。初始保守限制为：提示词 1～5,000 字符；每类最多一个参考，总计最多三个；图片 JPEG/PNG/WebP 且不超过 10 MiB；视频 MP4/MOV 且不超过 200 MiB；音频 MP3/WAV/AAC 且不超过 50 MiB；总引用大小不超过 250 MiB。所有媒体必须通过 MIME 魔数和 FFprobe/图片解码双重验证。真实探测发现模型限制更严格时，目录按模型收窄能力，不能扩大推定。

### TOS `ossutils`

新增服务端全局模块 `server/storage/ossutils.ts`，使用官方 `@volcengine/tos-sdk`。它只负责对象存储，不感知业务工作流，对外暴露：

```ts
interface OssUtils {
  putStagedFile(input: {
    filePath: string;
    sizeBytes: number;
    sha256: string;
    mimeType: string;
    jobId: string;
  }): Promise<{ key: string; etag?: string }>;
  createSignedReadUrl(key: string, expiresSeconds?: number): Promise<string>;
  deleteObject(key: string): Promise<void>;
  deleteMany(keys: string[]): Promise<void>;
}
```

配置变量为 `TOS_ACCESS_KEY_ID`、`TOS_SECRET_ACCESS_KEY`、`TOS_REGION=cn-shanghai`、`TOS_ENDPOINT=tos-cn-shanghai.volces.com`、`TOS_BUCKET=xbeacon`。密钥只写入被 Git 忽略的 `.env`，示例文件仅保留占位符。启动时只报告配置是否完整，不打印值。

Bucket 必须保持私有。对象 Key 使用 `seedance-staging/<job UUID>/<random UUID>.<ext>`，不包含邮箱、用户 ID、原文件名或提示词。TOS 凭证采用独立最小权限策略，只允许 `xbeacon/seedance-staging/*` 前缀所需的 Put/Get/Head/Delete 和分片上传操作，不授予其他 Bucket、其他前缀、ACL 或策略管理权限。若当前凭证未达到此前缀级限制，报告为生产阻断项。

Worker 在进入 `ossutils` 前完成用户所有权、文件真实路径、允许素材根目录 containment、MIME、长度和 SHA-256 校验。`ossutils` 使用 SDK 的流式分片/文件上传，不把完整媒体读入内存；进程级加权信号量限制同时处于上传中的总素材字节数和任务数。上传设置准确 Content-Type；分片失败或进程中断恢复时必须 Abort 未完成 upload，并删除可能生成的对象，待清理记录持久化。若账号/Bucket 支持 TOS 服务端加密，则启用 SSE-TOS，否则在上线前将其作为显式安全缺口报告，不能伪称已加密。

签名读取 URL 的有效期必须覆盖配置的最长上游核对窗口（默认 24 小时），只传给 AIHubMix，不写入任务结果、通知或普通日志。对象保留到上游任务终态或 Provider 明确证明已经完成素材摄取后再删除；本地前台超时本身不触发删除。对象分为 `active` 与 `cleanup-ready`：活动对象不受定时生命周期删除，确认上游终态后先标记为可清理并立即删除；若 TOS 支持按标签筛选的生命周期，则只对 `cleanup-ready=true` 配置 24 小时兜底，绝不对整个活动前缀设置无条件 24 小时删除。重试重新上传并生成新 Key/签名，禁止复用过期 URL。清理失败进入持久化待清理记录并由启动恢复任务重试。

引用必须来自当前用户拥有的 `media_assets`。服务端读取本地文件、验证后上传 TOS，再生成签名 URL；客户端提交的任意公网 URL不得直接透传。真实多模态验收必须走与页面完全相同的“本地上传 → 所有权验证 → TOS → 签名 URL → AIHubMix”路径。

### 工作流映射

“最终输出视频”不等于“调用视频生成模型”。界面统一提供“生成引擎”区域，但只有确实包含生成阶段的模式才显示可操作的 Seedance 选择器；纯 FFmpeg 工具显示只读的“本地处理，不使用视频生成模型”，不提交也不保存 `videoModel`，避免形成模型已生效的错误暗示。

| 功能 | 当前执行性质 | Seedance 选择器 | 执行语义 |
| --- | --- | --- | --- |
| 爆款二创 | `video-generate` | 启用，默认 Fast | 调用用户选择的 Seedance |
| AI 创作 | `multimodal-generate` | 仅视频输出时启用 | 文本/图片输出不提交 `videoModel` |
| 一键成片 | 文本、配音、字幕与本地合成 | 禁用并说明本地处理 | 本轮不增加隐含付费生成步骤 |
| 视频分割 | FFmpeg | 禁用并说明本地处理 | 不调用 Seedance |
| 视频混剪 | FFmpeg | 禁用并说明本地处理 | 不调用 Seedance |
| 视频修复 | FFmpeg/本地滤镜 | 禁用并说明本地处理 | 不调用 Seedance |
| 字幕擦除 | FFmpeg/本地滤镜 | 禁用并说明本地处理 | 不调用 Seedance |
| 画质增强 | FFmpeg/本地滤镜 | 禁用并说明本地处理 | 不调用 Seedance |
| 爆款裂变 | 模板与本地批量渲染 | 禁用并说明本地处理 | 不调用 Seedance |

后续若某个纯本地工具新增“AI 生成画面”模式，该模式必须作为独立、显式的执行模式接入同一模型目录、OpenAPI 字段和真实测试矩阵，不能仅通过在现有页面上放置选择器获得 Seedance 能力。

## 数据流

1. 前端通过唯一的规范目录接口 `GET /api/models`（OpenAPI operation `getModels`）获取全部已批准模型，按 `capability: "video"` 过滤三款 Seedance，并采用其中唯一 `isDefault` 条目作为默认值。不新增并行的 `/api/video-models`。
2. 生成型任务在 OpenAPI 请求顶层提交显式 `videoModel`；纯本地任务不携带该字段。
3. OpenAPI 根据模块/模式约束该字段：生成型视频模式必填且只能是三款 Seedance；其他模式禁止携带。非法值或 Wan 返回 `422 INVALID_VIDEO_MODEL`。
4. 后端在创建任务前使用同一目录再次校验，不信任生成 SDK 之外的客户端。
5. 执行计划将精确模型记录到生成阶段 provenance。
6. Worker 根据当前用户的素材所有权记录解析引用，验证媒体并上传 TOS；数据库只持久化对象 Key，不持久化签名 URL。
7. Provider 使用 Seedance 专用 `extra_body` 创建任务，并先持久化上游任务 ID，再开始轮询。
8. 终态成功后下载视频到本地结果目录，经 FFprobe 验证后登记 artifact；随后删除 TOS 暂存对象。
9. SQLite、内存队列、SSE 和通知沿用现有用户隔离规则，并增加上游状态与清理状态字段。

## 前端交互

模型选择器展示名称、定位标签、介绍和“支持音/视/图/文参考”能力标签。默认选中 Seedance 2.0 Fast。

所有最终输出视频的功能配置都展示“生成引擎”区域。生成型模式显示模型选择器；纯本地模式显示禁用说明。对于 AI 创作，仅当输出类型为视频时显示或启用；切换为文本或图片时清除 `videoModel`，不得把视频模型误认为当前执行模型。

历史任务继续展示其原始模型来源，即使来源为 Wan。新任务的选择器和请求白名单中不再出现 Wan。

## 失败语义

- 用户选择哪个 Seedance 模型，任务就只调用该模型。
- 上游创建、轮询或下载失败时，任务进入 `failed`。
- 不切换其他 Seedance 模型，不回退 Wan，不回退 Mock。
- 错误对象保留稳定的内部错误码、用户可理解的信息、可重试标记和请求 ID；Provider 原始响应只保留经过截断和脱敏的摘要。
- 用户可原模型重试，或返回配置页手动更换模型。
- 超时和取消必须停止前台高频轮询、下载和产物登记；若尚未确认上游终态，必须继续持久化的后台低频 reconciliation 查询，但不得下载或登记产物。
- 本地 FFmpeg 后处理失败同样明确失败，不得返回模拟成功。

每个 Provider 任务在 SQLite 持久化 `provider_model`、`provider_task_id`、`provider_status`、`provider_submitted_at`、`provider_deadline_at`、`provider_cancel_state`、`staging_keys_json` 和 `job_schema_version`。上游创建返回后必须在同一 Worker 流程中立即保存任务 ID，再进入轮询；默认前台等待截止时间为 20 分钟。该截止时间不是上游终态，也不直接把任务变成可重试的 `failed`。

取消采用以下确定性顺序：

1. 创建请求尚未返回时先记录取消意图；一旦获得上游 ID，立即再次检查取消并调用 `DELETE /v1/videos/{id}`，不进入正常轮询。
2. 已在轮询时调用上游删除并停止前台轮询。若上游不支持删除或删除失败，本地 `job.status` 保持 `processing`、`provider_status` 进入持久化 `reconciling`，页面据此显示“取消核对中”，后台低频查询上游；永不登记该任务的产物。确认上游终态后，本地才原子转为 `cancelled`。
3. 若视频已下载但尚未登记 artifact，取消优先，删除临时结果；若 artifact 已原子登记且任务已成功，后续取消返回 `409 TASK_ALREADY_TERMINAL`。

达到 20 分钟截止时间时停止高频前台轮询、尝试上游 DELETE，并让本地 `job.status` 保持 `processing`、`provider_status` 转为 `reconciling`；只要上游仍非终态，保留 TOS 参考对象，初始签名 URL 已按最长核对窗口签发。后台以低频率查询，直至确认 succeeded/failed/cancelled：若超时后晚到成功，仅记录 `UPSTREAM_COMPLETED_AFTER_TIMEOUT` 并丢弃结果，不登记 artifact；确认终态后才清理 TOS，并把超时任务结束为 `failed`、用户取消任务结束为 `cancelled`。超过默认 24 小时仍无终态时进入人工核对告警，活动素材继续保留，不自动重发或删除。设计明确禁止通过“风险确认”绕过这一规则再次付费提交。

进程重启时，有 `provider_task_id` 的非终态任务只能恢复查询，绝不重新创建。若进程在上游接受请求后、保存 ID前崩溃，无法可靠判断是否已计费，任务标记为 `PROVIDER_SUBMISSION_UNKNOWN`，禁止自动重发，并要求人工通过 Provider 控制台/API 核对后才能解除。原任务处于 `reconciling` 或上游其他非终态时，任何重试返回 `409 UPSTREAM_STILL_RUNNING`。只有上游明确终态且本地清理完成后才可创建新上游任务；“原模型重试”保留原模型，“修改配置重试”创建新任务。

在 `FORCE_MOCK=true` 的端到端测试环境中允许测试替身执行，但生产/正常开发环境中，用户明确选择 Seedance 后不得静默降级。测试替身必须在 provenance 中标记为 Mock。

## Wan 移除与兼容

- 从 SDK 注册表删除 `wan2.6-t2v` 视频模型条目。
- 从执行计划默认模型和新任务模型白名单移除 Wan。
- 从前端模型选项删除 Wan。
- 保留通用 `/v1/videos` 查询和下载代码，因为 Seedance 继续使用该协议。
- 不重写历史任务 JSON，不删除历史 Wan 测试产物和来源证据。
- 能力报告的新一轮完整报告必须只把当前启用的三款 Seedance 计入视频模型覆盖率；旧报告只能作为历史记录。

启动迁移在单个 SQLite 事务中识别 execution plan/provenance 为 `wan2.6-t2v` 的历史任务：

- 已成功、已失败、已取消的终态任务保持原状态和原始 provenance。
- `queued` 或 `processing` 的 Wan 任务统一结束为 `failed / MODEL_RETIRED`，因为旧实现没有可恢复的持久化上游任务 ID，不得把它们换成 Seedance 继续执行。
- 重试历史 Wan 任务返回 `409 MODEL_SELECTION_REQUIRED`，界面引导到新建任务页重新选择 Seedance；不保留 Wan 适配器作为兼容重试路径。
- 历史记录视为 `job_schema_version=1`；新 Seedance 任务写入版本 `2`。迁移必须幂等，并覆盖成功、排队、执行中、失败和取消五类夹具测试。

## OpenAPI 与 SDK

OpenAPI 扩展既有且唯一的 `GET /api/models` / `getModels`，返回模型 ID、Provider、capability、名称、介绍、标签、参考能力、默认参数、`isDefault`、启用状态和真实测试状态。任务创建 Schema 把 `videoModel` 提升为顶层显式字段，并生成三值联合类型；不得把模型选择藏在 `Record<string, unknown>` 的 `values` 中。生成型视频模式使用带必填 `videoModel` 的判别联合分支，纯本地模式分支禁止该字段。

生成的 TypeScript SDK 必须提供模型目录类型和接口，前端不得复制手写模型联合类型。

构建时增加目录漂移测试：实际 `GET /api/models` 响应中过滤出的启用视频集合、OpenAPI enum、生成 SDK 类型、后端运行时校验器、前端选项和 SDK registry 必须严格相等，默认项也必须唯一且一致。前端只能消费该规范响应，不能维护第二份列表。

## 测试与验收

### 真实模型测试

先执行 TOS SDK 独立验收：使用 `xbeacon` 流式上传一个小型测试对象、Head 校验元数据、通过 60 分钟签名 URL读取并核对 SHA-256、确认未签名访问不可读、删除后确认对象不存在；另外人为中断一次分片上传，确认 upload 已 Abort、无可读残留对象且待清理记录最终清空。测试日志只记录 Region、Bucket、脱敏 Key 后缀、状态码、ETag 和校验和，不记录凭证或完整签名 URL；不改变 Bucket ACL。若最小权限凭证、服务端加密和 24 小时生命周期尚未配置，报告明确缺口并阻止生产就绪结论。

随后保存带时间戳的 AIHubMix 实时模型目录证据，并对每个模型执行最多三条已受理的真实生成任务：

1. 纯文本，`generate_audio=true`。
2. 本地图片参考，`generate_audio=false`。
3. 本地视频和音频联合参考。

每个被宣传为“音视图文均可参考”的模型都必须实际覆盖图片、视频和音频；允许在一条任务中组合视频与音频，但不能从其他模型的结果推定。每条任务都必须走页面同一条“本地上传 → 所有权验证 → TOS → 签名 URL → AIHubMix”路径，并完成创建、轮询、下载、SHA-256、MIME 检查和 FFprobe。成功任务使用 720p、4 秒或 Provider 实际允许的最小时长，单任务最多等待 20 分钟；参数在创建前被拒绝的探测不计入三条受理任务。

Evidence 每条记录模型 ID、非敏感请求摘要、Mini 实际接受的完整字段形状、引用类型、生成音频开关、Provider request/task ID、开始/结束时间、配置指纹、终态响应摘要、文件校验和、MIME、FFprobe 结果和清理结果。除“存在视频流”外，还要断言：720p + 16:9 请求对应 1280×720（像素必须精确；若 Provider 文档允许其他方向则按文档值）、显示比例误差不超过 1%、成片时长与请求值相差不超过 1 秒、`generate_audio=true` 时存在可解码音频流、`false` 时不存在音频流。Provider 若偏离请求，Evidence 记录偏差并收窄/修正目录默认参数，不能仍判为该参数已验证。水印仅在响应元数据或成片可客观验证时标记“已验证”；否则记录“不可验证”，不得过度宣称。

三款模型都必须分别通过最基础的“创建 → 成功终态 → 下载 → 媒体断言”，才可在正常开发/生产配置中保持启用和可选择；仅出现在实时目录不算可用。任一模型连基础文本生成都失败，则生产就绪验收整体失败，该模型标记 `enabled=false` 并报告缺失能力，不能用 Mock 冒充第三个可用模型。若仅某种参考模态失败，则保留已经通过基础生成的模型，但移除该模型对应的参考能力和前端标签。

### 自动化测试

- 视频模型目录包含且只包含三款 Seedance，默认值为 Fast。
- 非白名单模型和 Wan 模型被拒绝。
- 每个最终输出视频的模块都包含准确的生成引擎状态；仅生成型模式包含模型选择。
- AI 创作仅在视频模式使用所选模型。
- 选择的模型进入执行计划和最终 provenance。
- Seedance 失败不会触发其他模型或 Mock。
- 多账号素材所有权校验仍然有效。
- 取消和超时不会登记产物。
- 创建后取消、轮询中取消、完成/取消竞争、进程重启恢复和未知提交状态均有确定性测试。
- 前台截止但上游仍运行、DELETE 失败/不支持、晚到成功、核对中重试和最终暂存清理均有确定性测试。
- 进入 `provider_status=reconciling` 后仍会执行后台低频状态查询，同时明确断言不会下载或登记产物。
- TOS 流式分片上传、中断 Abort、并发字节上限、签名读取、删除、清理重试和引用所有权均有自动化测试；签名 URL不会进入持久化结果或日志。
- 历史 Wan 五类状态的迁移和重试行为通过测试。
- OpenAPI 重新导出，TypeScript SDK 重新生成。
- `typecheck`、单元测试、生产构建和完整 Playwright 回归通过。

## 完成标准

- 前端可以选择三款 Seedance，并看到准确中文介绍。
- 所有生成型视频工作流保存并尊重用户选择；纯本地视频工具明确不使用模型。
- Wan 不再参与任何新任务执行。
- 三款 Seedance 都有本轮覆盖文本、图片、视频和音频参考的真实全链路证据；若 Provider 不支持，能力目录和报告如实收窄。
- 失败时任务明确失败，不发生隐式模型切换或 Mock。
- 规范 `GET /api/models`、OpenAPI、生成 SDK、后端校验器、前端选项、SDK registry 和能力报告对模型集合的描述一致。
- TOS 上海 `xbeacon` 的上传、私有读取、签名 URL和删除实测通过；仅已确认上游终态且标记 `cleanup-ready` 的暂存对象具备 24 小时兜底清理，活动对象不会被生命周期误删；未满足则不能标记生产就绪。
