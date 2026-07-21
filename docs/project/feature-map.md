# 现有功能地图

> 最后更新：2026-07-21；开放状态以 `web/app/config.ts` 为准。

| 模块 | 路径 | 当前开放 | 主要实现 |
| --- | --- | --- | --- |
| 爆款二创 | `/aigc/video-remix` | 是 | 专用页面、项目接口、视频分析 Job |
| 一键成片 | `/aigc/video-create` | 是 | 专用工作台、`server/video-create/`、专用 Job |
| 口播脚本 | `/aigc/ad-script` | 是 | 专用页面、`server/ad-script/`、专用 Job |
| AI 创作、素材理解、视频混剪 | `/tools/*` | 否 | 专用/通用页面与任务定义已保留 |
| 视频分割、音色克隆 | `/tools/video-cut`、`/tools/voice-clone` | 是 | `ModulePage`、专用 Handler |
| 视频修复、字幕擦除、画质增强、爆款裂变 | `/tools/*` | 否 | `ModulePage`、通用 Job 定义 |
| 媒体、商品、音色、人像库 | `/assets/*` | 是 | 资产库、人像库、账号/上传/TOS 接口 |

## 共享影响面

| 修改位置 | 回归范围 |
| --- | --- |
| `web/app/config.ts`、`routes.ts`、`router.tsx` | 菜单、首页、路由、模块配置 |
| `web/components/domain/module-page.tsx` | 所有通用模块的校验、上传、提交和任务展示 |
| `server/app.ts`、`web/api/generated/` | API 契约、SDK、鉴权、owner 隔离 |
| `server/db/schema.ts`、`drizzle/` | Server/Worker 数据、migration 与 Store 测试 |
| `server/jobs/`、`shared/jobs/`、`worker/jobs/` | 投递、取消、重试、恢复、Handler 与结果状态；按 [Job 索引](../worker/jobs/README.md) 做定点回归 |
| `server/uploads/`、`server/storage/` | 上传限制、私有读取、对象清理 |

新增功能需明确其页面/接口/任务类别，并检查功能开关、API SDK、migration、幂等、取消、重试、恢复、owner 隔离、文件语义及相关单测/E2E。
