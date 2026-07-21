# 视频混剪 Job

## 适用范围

- 模块：`video-mashup`
- Handler：`worker/jobs/job-video-mashup.ts`
- 不处理旧片段合并兼容值 `mergeMode=video-cut-clips`

## 输入

`job.values.config` 保存版本化 `VideoMashupConfig` JSON，契约位于 `shared/video-mashup/config.ts`。配置包含视频组、组合模式、分辨率、输出数量和目标素材文件夹。

Server 在投递前校验配置、视频 MIME、素材 owner 和文件夹 owner；Worker 执行时再次校验。

## 执行流程

1. 下载所有去重后的源视频。
2. 使用 FFprobe 验证视频流。
3. 将每个源视频标准化为目标分辨率、30 FPS、H.264/AAC MP4；无音频素材补静音轨。
4. 使用共享组合算法生成稳定批次计划。
5. 每个组合按视频组顺序拼接，保留首段原声并静音后续片段。
6. 逐个上传私有 TOS，登记素材库并持久化 artifact 和组合键。
7. 根据成功/失败数量写入 `succeeded`、`partially_succeeded` 或 `failed`。

## 恢复与取消

- 成功组合键保存在 `result.data.values.completedCombinationKeys`。
- 重试跳过已经持久化的成功组合。
- 素材标准化失败只影响引用该素材的组合，其余组合继续。
- 每个主要阶段检查 `cancelRequested`。
- TOS 上传通过 `AbortSignal` 响应取消，并清理未完成的分片对象。
- 已经上传并登记的成片在取消或部分失败时保留。

## 输出

- `result.kind`：`video-mashup`
- 每个成功组合对应一个视频 artifact 和一个用户素材库记录。
- 输出格式：H.264/AAC MP4，存储在目标文件夹的 `generated/<jobId>/` 前缀。

