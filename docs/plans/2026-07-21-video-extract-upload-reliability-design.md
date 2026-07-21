# 视频提取上传可靠性修复设计

## 问题

视频提取任务能够完成直链下载与媒体校验，但 `@volcengine/tos-sdk` 的 multipart `uploadFile` 在 Bun Worker 中上传到约 81% 后挂起。BullMQ 随后因任务锁失效将任务标记为 `job stalled more than allowable limit`，前端只显示统一的“Worker 执行失败”。

## 方案

- 视频提取保存素材时改用 TOS `putObjectFromFile` 单对象上传，保留私有 ACL、AES256 服务端加密和进度回调。
- 在共享 TOS 工具中提供明确的单对象上传模式，仅由视频提取启用，避免无意改变其他任务的 multipart 行为。
- 上传进度只在整数百分比发生变化时回写任务，减少同步 SQLite 写入频率。
- 失败任务页面展示后端保存的真实错误消息，同时保留统一失败状态。
- 真实验证必须覆盖：BullMQ 入队、Worker 消费、下载、ffprobe、TOS 上传、素材记录创建和任务成功回写。

## 错误与清理

- 单对象上传失败时删除目标对象，避免留下不完整素材。
- 临时下载文件始终在 Handler 的 `finally` 中删除。
- 真实测试仅运行一个 Worker，避免多个开发 Worker 竞争同一队列。

## 验证

- 为单对象上传模式补充单元测试。
- 运行类型检查及相关 Worker 测试。
- 使用用户提供的公开视频 URL 执行一次真实 BullMQ Job，并核对任务、素材记录与 TOS 对象。
