# 视频剪辑持久化媒体地址修复设计

## 问题

剪辑器将 `URL.createObjectURL(file)` 返回的临时 `blob:` 地址写入 localStorage。刷新页面后浏览器会撤销该地址，Remotion Player 和素材缩略图因此加载失败。

## 方案

- 草稿中的每个素材只保存素材 ID和稳定的 `/api/assets/{assetId}/content` 地址，不持久化运行期 blob URL。
- 页面加载或素材列表变化时，通过现有鉴权下载逻辑为稳定地址生成当前页面可用的 blob URL。
- Remotion Player 和素材缩略图使用运行期时间线；导出协议继续清空 URL并由 Worker 根据 assetId 读取素材。
- 页面卸载或素材变化时统一撤销运行期 blob URL。
- 加载旧草稿时，根据 assetId 将已有 `blob:` 地址自动迁移为稳定素材地址。

## 验证

- 刷新页面后已上传素材仍能恢复预览。
- localStorage 不再包含 `blob:` 地址。
- 添加素材、剪辑和导出数据结构保持兼容。
- 运行时间线单测、类型检查和生产构建。
