# 视频片段合并 Job

## 定位

`worker/jobs/job-video-clip-merge.ts` 是 `video-cut` 的特化 Handler，仅在 `mergeMode === "video-cut-clips"` 时合并多个已有视频片段。

## 维护边界

- 它必须先于普通 [视频切分 Job](video-cut.md) 注册，否则会被后者错误接管。
- API 创建任务时负责校验至少两个视频资产和目标文件夹；Handler 不应放宽 Server 的 owner/MIME 验证。
- 合并使用媒体工具并回写结果/执行来源；对应 Definition 仍为 `definitions/video-cut.ts`。

回归：片段数量、非视频资产、跨用户资产、合并失败、取消、输出文件夹与下载结果。

