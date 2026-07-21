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
| ACP 任务记录 | `chore_folder/acp_agreement/task_records/20260721-douyin-ts-downloader/` |
| 最后更新 | 2026-07-21 |

## 背景、目标与范围

用户已验证 Python 原型能下载目标抖音视频。首版将同一主流程迁移到烽火 AI：从素材库提交一条用户有权处理的公开抖音分享链接，异步下载并保存为该用户的私有视频素材。

- 本次包含：分享文本解析、多平台识别（抖音/快手/YouTube/X）、抖音完整下载、统一导入 Job、私有资产入库、失败可见。
- 本次不包含：批量导入、登录、Cookie 持久化、私密/受限内容、验证码、快手/YouTube/X 下载、去水印承诺。
- **已支持下载**: 抖音（douyin）— 标准 URL + 分享码提取，Playwright Chromium 下载
- **仅识别未下载**: 快手（kuaishou）、YouTube、X (Twitter)

## 用户流程与详细需求

| 需求 ID | 优先级 | 描述 | 验收方式 |
| --- | --- | --- | --- |
| `REQ-01` | Must | 用户在素材库中粘贴一条允许的抖音分享 URL 并选择自己的文件夹。 | 非法 URL、无权文件夹和未登录请求均被拒绝。 |
| `REQ-02` | Must | API 创建可恢复、可取消、按幂等键去重的后台导入任务；API 不下载文件。 | Job/队列测试。 |
| `REQ-03` | Must | Worker 使用 Playwright 取得允许的媒体响应，在浏览器上下文下载 MP4 并入库。 | Worker 测试与获授权公开链接人工验证。 |
| `REQ-04` | Must | 成功后素材库显示新视频；失败/取消显示明确状态且不泄露临时媒体 URL。 | UI/E2E 测试。 |

## 对现有功能的影响

| 检查项 | 是否影响 | 说明与回归措施 |
| --- | --- | --- |
| 路由、菜单、默认首页、通用 ModulePage | 否 | 入口位于既有素材库工具栏，不新增主菜单模块。 |
| 专用创作流程与资产库 | 是 | 成功结果复用 `MediaAsset`、文件夹和素材列表刷新机制。 |
| API 契约、生成 SDK、鉴权和 owner 隔离 | 是 | 新受保护 API，使用 JWT 身份和 AccountStore 的 folder/asset 所有权检查。 |
| SQLite Schema、Drizzle migration、数据兼容 | 否 | 复用现有 jobs 与 media_assets 表；仅扩展后台 Job 类型。 |
| BullMQ、Redis、Worker、SSE 和任务状态 | 是 | Server 持久化并投递，Worker 专用 Handler 回写状态和结果。 |
| 上传、TOS、结果文件和创作点 | 是 | 复用私有 TOS/本地资产存储；不收费；临时文件总在 finally 清理。 |
| 样式、单测、E2E | 是 | 复用素材库弹窗模式，新增状态和错误覆盖。 |

## 技术方案、风险与验收

详见 [翻译与实施设计](../plans/2026-07-21-douyin-video-import-design.md)。下载仅服务于用户确认有权处理的公开内容；若发生登录、验证码或访问受限，任务必须失败而非规避限制。

## 发布、回滚与未决问题

- 部署必须安装 `playwright` 运行时依赖及 Chromium；不可用时 API/Worker 返回明确配置错误。
- 可通过移除素材库入口与拒绝新导入请求回滚；已保存素材沿用现有资产删除流程。
