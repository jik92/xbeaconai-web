# FEAT-0001 分享内容导入（多平台）

## 元信息

| 字段 | 内容 |
| --- | --- |
| ID | `FEAT-0001` |
| 状态 | `approved` |
| 负责人 | dp（实施），codex-root（方案与验收） |
| 提出日期 | 2026-07-21 |
| 目标版本 | 待 dp 实施后确定 |
| 关联 Issue / 原型 | `chore_folder/media_download_spider/dy_video_download_tool.py` |
| ACP 任务记录 | `20260721-douyin-ts-downloader/`（初始实现），`20260722-douyin-import-ui-migration/`（入口迁移至视频提取页） |
| 最后更新 | 2026-07-22 |

## 背景、目标与范围

用户已验证 Python 原型能下载目标抖音视频。首版将同一主流程迁移到烽火 AI：从**视频提取页**（`/utilities/video-extract`）的"新建任务"统一入口提交分享文案、短链接或直接视频 URL，系统自动解析并路由——识别到平台候选则创建 share-content-import 任务，直接公开视频 URL 则创建 video-extract 任务；多个候选时要求用户确认选择。任务清单合并展示两类任务及各自平台、状态、进度和结果。

- 本次包含：分享文本解析、多平台识别（抖音/快手/YouTube/X）、抖音完整下载、统一导入 Job、私有资产入库、失败可见。
- 本次不包含：批量导入、登录、Cookie 持久化、私密/受限内容、验证码、快手/YouTube/X 下载、去水印承诺。
- **已支持下载**: 抖音（douyin）— 标准 URL + 分享码提取，Playwright Chromium 下载
- **仅识别未下载**: 快手（kuaishou）、YouTube、X (Twitter)

同一用户、文件夹、平台与规范化链接的正在执行任务会被去重。失败/取消任务可以重新提交；已成功的任务只在其结果素材仍存在时复用，若用户删除了素材则会创建新的下载任务。

下载器在页面打开后等待 30 秒，再关闭已观察到的、可关闭的抖音登录引导浮层，然后继续等待公开视频的媒体请求。等待值可通过 `DOUYIN_LOGIN_GUIDANCE_WAIT_MS`（0–120000 毫秒）调整。该操作不登录账号、不保存 Cookie，也不规避验证码、私密视频或其他访问限制。

当前允许捕获的抖音媒体主机为精确白名单：`v26-web.douyinvod.com`、`v3-web.douyinvod.com`、`v11-weba.douyinvod.com` 和 `sf3-sign.douyinstatic.com`。新增主机必须单独验证后加入，不使用宽泛的域名后缀匹配。

### 本地可视化排查

默认 Worker 使用无头 Chromium。若需要观察抖音实际展示的登录、验证码或访问限制页面，可仅在本地 `.env` 设置：

```dotenv
DOUYIN_BROWSER_HEADLESS=false
DOUYIN_BROWSER_DEBUG_PAUSE_MS=60000
```

提交一次导入任务后，会出现一个临时 Chromium 窗口并在页面打开后暂停 60 秒。该会话仅用于当前任务，任务结束即关闭并清除 Cookie；它不使用日常 Chrome 的登录态，也不应用于生产环境。

## 用户流程与详细需求

| 需求 ID | 优先级 | 描述 | 验收方式 |
| --- | --- | --- | --- |
| `REQ-01` | Must | 用户在视频提取页"新建任务"统一入口粘贴分享文案/短链接/直接 URL，系统自动解析并路由（平台候选→share-content-import，直接 URL→video-extract），多候选时要求用户确认。 | 非法 URL、无权文件夹和未登录请求均被拒绝。 |
| `REQ-02` | Must | API 创建可恢复、可取消、按幂等键去重的后台导入任务；API 不下载文件。 | Job/队列测试。 |
| `REQ-03` | Must | Worker 使用 Playwright 取得允许的媒体响应，在浏览器上下文下载 MP4 并入库。 | Worker 测试与获授权公开链接人工验证。 |
| `REQ-04` | Must | 任务清单同时展示 video-extract 和 share-content-import 任务；每条分享导入任务显示平台名、状态、进度、结果（成功素材/不支持/失败原因）。 | UI/E2E 测试。 |

## 对现有功能的影响

| 检查项 | 是否影响 | 说明与回归措施 |
| --- | --- | --- |
| 路由、菜单、默认首页、通用 ModulePage | 否 | 入口为视频提取页（`/utilities/video-extract`）的"新建任务"按钮（唯一入口），自动解析路由，不新增主菜单模块。 |
| 专用创作流程与资产库 | 是 | 成功结果复用 `MediaAsset`、文件夹和素材列表刷新机制。 |
| API 契约、生成 SDK、鉴权和 owner 隔离 | 是 | 新受保护 API，使用 JWT 身份和 AccountStore 的 folder/asset 所有权检查。 |
| SQLite Schema、Drizzle migration、数据兼容 | 否 | 复用现有 jobs 与 media_assets 表；仅扩展后台 Job 类型。 |
| BullMQ、Redis、Worker、SSE 和任务状态 | 是 | Server 持久化并投递，Worker 专用 Handler 回写状态和结果。 |
| 上传、TOS、结果文件和创作点 | 是 | 复用私有 TOS/本地资产存储；不收费；临时文件总在 finally 清理。 |
| 样式、单测、E2E | 是 | "新建任务"统一弹窗替代独立分享导入弹窗；`classifyInput` 纯函数通过 bun test 覆盖路由决策逻辑。 |

## 技术方案、风险与验收

详见 [翻译与实施设计](../plans/2026-07-21-douyin-video-import-design.md)。下载仅服务于用户确认有权处理的公开内容；若发生登录、验证码或访问受限，任务必须失败而非规避限制。

## 发布、回滚与未决问题

- 部署必须安装 `playwright` 运行时依赖及 Chromium；不可用时 API/Worker 返回明确配置错误。
- 可通过移除视频提取页分享导入入口与拒绝新导入请求回滚；已保存素材沿用现有资产删除流程。

## 服务端日志

Worker 在执行过程中输出结构化 JSON 日志，前缀为 `[douyin-import]`。

### 查询方式

```bash
# 按 jobId 查询一条任务的完整日志
grep '\[douyin-import\]' server.log | grep '"jobId":"<job-id>"'
```

### 日志阶段

| 阶段 | 含义 |
| --- | --- |
| `download_start` / `download_complete` / `download_failure` | 浏览器下载 |
| `probe_start` / `probe_complete` / `probe_failure` | ffprobe 视频校验（仅生产路径） |
| `save_local_start` / `save_local_complete` / `save_local_failure` | 本地文件写入 `.data/uploads/` |
| `tos_upload_start` / `tos_upload_complete` / `tos_upload_failure` | TOS 对象存储上传 |
| `tos_skip` | TOS 未配置，仅本地存储 |
| `asset_created` / `asset_create_failure` | SQLite 素材记录创建 |
| `success` | 任务成功 |
| `cancel` | 任务被取消 |
| `failure` | 任务整体失败 |
| `cleanup` | 临时文件清理完成 |

### 常见失败排查

| 阶段 | 常见错误 | 排查方向 |
| --- | --- | --- |
| `download_complete` 未出现 | 下载超时/`access_restricted` | 确认链接公开可访问，检查 Playwright/Chromium 可用 |
| `probe_complete` 未出现 | ffprobe 不可用 | 确认 `ffprobe` 已安装 |
| `save_local_complete` 未出现 | 磁盘空间不足或权限问题 | 检查 `YAOZUO_DATA_DIR` 可写 |
| `tos_upload_complete` 未出现 | TOS 配置或网络问题 | 检查 TOS 凭证和 endpoint |

### 脱敏规则

日志**严格禁止**记录：
- CDN 临时地址（如 `v26-web.douyinvod.com`）
- 分享文案全文或提取的 URL
- Cookie、请求头、Token
- 用户凭据或 JWT

日志**可以**记录：
- `jobId`（用于关联检索）
- 阶段名称、耗时（`durationMs`）
- 文件大小（`fileSizeBytes`，仅非敏感数值）
- 稳定错误码（如 `access_restricted`、`config_error`）
- 脱敏后的错误摘要（URL 替换为 `[REDACTED_URL]`）
