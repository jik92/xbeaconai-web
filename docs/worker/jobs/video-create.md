# 一键成片 Job

## 定位

`worker/jobs/job-video-create.ts` 处理 `moduleId === "video-create"`，使用 `VideoCreateStore` 运行可恢复的项目工作流，并把脚本、分镜、镜头和成片状态回写 SQLite。

## 维护边界

- 项目和 API 位于 `server/video-create/` 与 `server/app.ts`；前端工作台为 `web/features/video-create/`。
- 每个阶段必须以持久化项目状态为依据，失败时保留可用产物，避免重复推进已完成阶段。
- 公开视频阶段定义为 `worker/jobs/definitions/video-create.ts`；涉及 Seedance 上游调用时复用 [共享 Seedance 流程](seedance-video.md)。

修改时重点验证阶段门槛、单镜头失败/重试、替代素材、最终合并、重启恢复、幂等和执行来源。设计背景见 [一键成片工作台设计](../../plans/2026-07-21-video-create-workbench-design.md)。

