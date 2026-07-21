# 抖音公开视频链接导入：Python 到 TypeScript 的翻译与实施设计

## 目标架构

```text
素材库导入弹窗 → 受保护 API → SQLite Job + BullMQ → Worker Playwright
                                                    ↓
                              临时 MP4 → 私有 TOS/本地存储 → MediaAsset → 素材库刷新
```

Server 只验证、持久化并投递任务；浏览器自动化和文件下载只在 Worker 执行。临时 CDN URL 只存在于 Worker 的一次执行内，不返回前端、不写入业务记录。

## Python → TypeScript 映射

| Python 原型 | TypeScript 设计 |
| --- | --- |
| `async_playwright().start()` / Chromium | Worker 中 `playwright` 运行时依赖与 `chromium.launch()`。 |
| `page.add_init_script("stealth.min.js")` | 由专用下载器加载同等初始化脚本；路径以模块目录解析，不能依赖启动目录。 |
| `page.on("response")` 截获媒体请求 | 只接受严格允许的 Douyin media host，选择第一个视频响应；其他响应忽略。 |
| 页面刷新后 `fetch()` + 下载锚点 | 在同一 Page 内执行受控 fetch 与下载，使用 `expect_download()` 保存到 Worker 临时目录。 |
| `/tmp/<name>.mp4` | `mkdtemp()` 任务专属目录；完成、失败或取消后 `finally` 删除。 |
| 直接返回本地路径 | 通过现有私有存储与 `AccountStore.createAsset()` 创建 owner-scoped `MediaAsset`，仅返回 asset/job 信息。 |

## 组件设计

- `server/imports/douyin-video.ts`：纯 URL/host 校验、Playwright 生命周期和下载结果；禁止记录敏感 URL。
- `server/types.ts`：将后台导入 Job 类型与导航 `ModuleId` 分离，避免为了非菜单任务污染 UI 功能开关。
- `server/app.ts`：新增 JWT 保护的导入创建/查询路由；验证链接、文件夹和幂等键后创建 Job 并投递。
- `worker/jobs/job-douyin-video-import.ts`：执行下载、取消检查、媒体探测、私有存储上传、Asset 创建、状态/通知回写。
- `worker/jobs/registry.ts`：在通用 fallback 前注册专用 Handler。
- `web/features/asset-library/`：在媒体素材库工具栏新增“从抖音链接导入”弹窗；提交后显示 Job 状态，成功刷新目标文件夹。

## 安全与失败策略

- 仅接受 HTTPS `v.douyin.com` 分享 URL；导航重定向和被捕获媒体主机均使用 allowlist。
- 不支持登录、私密视频、验证码或地区/访问限制绕过；这些情形返回结构化失败。
- 不持久化 Cookie、请求头、临时 URL 或浏览器调试输出；错误消息脱敏。
- 使用现有 owner/folder 读取和写入检查；下载结果必须是可探测的视频 MIME/MP4，才可入库。
- 取消前后均检查 Job 状态；上传后的异常按现有对象清理机制处理，临时目录始终清理。

## 依赖与验证

- 生产依赖使用 `playwright`，部署镜像/主机执行 Chromium 安装；缺浏览器时明确报配置错误。
- 单测 mock 浏览器边界，验证 allowlist、首个媒体选择、错误和清理。
- API/Worker 测试验证鉴权、folder owner 隔离、幂等、取消、Asset 创建和失败不留孤儿文件。
- UI 覆盖提交、进行中、成功、失败和素材列表刷新。
- API 改动后执行 `bun run api:spec`、`bun run api:generate`、相关测试、`bun run typecheck`、`bun run build`；获授权公开链接仅做人工冒烟，不纳入普通 CI。
