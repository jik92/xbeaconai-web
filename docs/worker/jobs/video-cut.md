# 视频切分 Job

## 定位

`worker/jobs/job-video-cut.ts` 处理 `moduleId === "video-cut"` 且不是片段合并模式的任务，执行本地媒体切分并保存输出片段。

## 维护边界

- `mergeMode === "video-cut-clips"` 由 [视频片段合并 Job](video-clip-merge.md) 处理，二者依赖注册顺序和 `supports()` 条件区分。
- 输出文件、素材 owner、目标文件夹与 `autoSave` 语义必须保持一致；不要以临时内存结果代替资产/任务持久化。
- 对应定义为 `worker/jobs/definitions/video-cut.ts`，媒体工具在 `server/media/ffmpeg.ts`。

回归应覆盖切分策略、取消、文件夹 owner 校验、产物列表和本机 FFmpeg 不可用时的显式错误。

