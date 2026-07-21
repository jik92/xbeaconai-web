# 爆款二创分析 Job

## 定位

`worker/jobs/job-video-remix-analysis.ts` 仅处理 `moduleId === "video-remix"` 且 `workflowPhase === "analysis"` 的任务，负责参考视频的分析阶段和分析提示词产物。

## 维护边界

- 非分析阶段不能由本 Handler 接管；先确认 `workflowPhase` 与任务创建 API 的语义。
- 输出/阶段定义在 `worker/jobs/definitions/video-remix.ts`；视频模型或上游视频操作复用共享流程，不复制提交和轮询逻辑。
- 修改分析 Prompt 或结构化输出时，更新 `tests/unit/video-analysis-prompt.test.ts` 并验证来源标记。

