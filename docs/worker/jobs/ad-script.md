# 口播脚本 Job

## 定位

`worker/jobs/job-ad-script.ts` 处理 `moduleId === "ad-script"`。它使用 `AdScriptStore` 维护项目、变体和版本，并把每个变体的结果、评分、合规和终态写回 SQLite。

## 维护边界

- 专用 API、项目与版本模型在 `server/ad-script/`；不要将其折回通用字符串任务值。
- Handler 负责提取/生成、版本产物、批量变体进度和失败处理；通用投递、鉴权和账本仍由 Server/Store 负责。
- 对应公开阶段定义：`worker/jobs/definitions/ad-script.ts`。

修改前需阅读相关 [口播脚本设计与实施计划](../../plans/2026-07-21-ad-script-design.md)，并验证 owner 隔离、批量部分失败、取消、恢复、版本不可覆盖与退款语义。

