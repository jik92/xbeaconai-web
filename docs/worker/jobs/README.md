# Job 索引

> 每个文件对应一个独立 Handler 或跨 Handler 共享流程。以 `worker/jobs/registry.ts` 的实际注册顺序为准。

| Job / 流程 | 适用任务 | 源码 | 文档 |
| --- | --- | --- | --- |
| 口播脚本 | `ad-script` | `job-ad-script.ts` | [ad-script](ad-script.md) |
| 一键成片 | `video-create` | `job-video-create.ts` | [video-create](video-create.md) |
| 爆款二创分析 | `video-remix` 的 analysis 阶段 | `job-video-remix-analysis.ts` | [video-remix-analysis](video-remix-analysis.md) |
| 视频片段合并 | `video-cut` 且 `mergeMode=video-cut-clips` | `job-video-clip-merge.ts` | [video-clip-merge](video-clip-merge.md) |
| 视频切分 | 其余 `video-cut` | `job-video-cut.ts` | [video-cut](video-cut.md) |
| 音色克隆 | `voice-clone` | `job-voice-clone.ts` | [voice-clone](voice-clone.md) |
| 通用创作 | 未被专用 Handler 接管的公开模块 | `job-generic-creation.ts` | [generic-creation](generic-creation.md) |
| Seedance 共享流程 | 视频生成上游交互 | `job-seedance-video.ts` | [seedance-video](seedance-video.md) |

新增 Handler 时：新增本目录文档、更新本表、注册到 `registry.ts`（位于 fallback 前）、补充/注册对应 Definition，并更新受影响的功能文档。

