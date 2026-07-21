# 烽火 AI 项目文档

> 最后更新：2026-07-21

本目录保存项目长期知识、功能设计与实施计划。根目录 `README.md` 是轻量入口；本目录按“任务 → 领域 → 模块/Job”逐层展开。运行事实以源码、配置和自动化测试为准。

```text
README.md                 任务路由：每次开发必读
docs/README.md            文档区总索引
docs/project/             共享架构、开发与功能地图
docs/features|bugs/       需求/问题档案及模板
docs/worker/              Worker 领域与 Job 索引
docs/worker/jobs/<job>.md 单个 Handler 或共享 Job 流程
docs/plans/               阶段性设计与实施记录
```

## 导航

| 区域 | 内容 | 入口 |
| --- | --- | --- |
| 项目知识 | 项目定位、开发、架构、功能地图、使用方式 | [project/overview.md](project/overview.md) |
| 功能档案 | 新功能索引与需求模板 | [features/README.md](features/README.md) |
| Bug 档案 | 问题索引与解决方案模板 | [bugs/README.md](bugs/README.md) |
| Worker | Worker 边界、调度与 Job 路由 | [worker/README.md](worker/README.md) |
| 开发专题 | 音色克隆的接入资料 | [voice-clone-development.md](voice-clone-development.md) |
| 实施计划 | 已留存的设计与实施记录 | [plans/](plans/) |

不要将本目录作为一次性阅读清单。根据根 `README.md` 的任务路由，先读取一层索引，再打开相关的下层文档；实现某项已有功能前，可按需查阅相关 `plans/` 文档。

[ACP 协作与任务记录](project/acp-collaboration.md) 仅在宿主或项目规则明确绑定该协议后适用。

## 维护规则

- 修改实现时，同步更新受影响的长期文档；生成物、密钥、生产数据和逐条临时日志不进入本目录。
- API 契约、Drizzle migration、BullMQ/Worker、文件存储或功能开关的改变必须更新功能影响分析；Job 的 Handler、注册顺序或阶段定义改变时，还必须更新 `docs/worker/jobs/` 中对应文档。
- 新功能使用 `features/_template.md` 建档；Bug 使用 `bugs/_template.md` 建档。文档结论应能追溯到代码路径、测试、提交或 Issue。
- `plans/` 是阶段性设计和实施记录，不替代 `project/` 中的当前架构事实；发现两者不一致时，以已验证实现为准并更新长期文档。
