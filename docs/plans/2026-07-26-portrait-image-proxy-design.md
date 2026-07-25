# 人像图片加载修复设计

## 根因

`public/portraits.json` 能正常加载 1,125 条记录，远端 TOS 图片也返回 `200 image/png`，但响应强制携带 `Content-Disposition: attachment`。人像页面当前把远端 `source_url` 直接交给 `<img>`，导致浏览器没有以内联图片展示。

## 方案

新增只接受人像目录 ID 的公开只读图片路由 `/api/portraits/{portraitId}/content`。服务端用 `getPortraitById` 从受控目录解析远端 URL，下载后校验响应成功且 MIME 为图片，再以 `Content-Disposition: inline`、正确 MIME 和缓存头返回。

前端为 `Portrait` 增加派生的 `display_url`，统一指向上述路由。人像库、选择弹窗、视频创作和爆款二创的可视预览使用 `display_url`；模型请求和持久化选择仍保留原始 `source_url`，避免改变模型输入契约。

## 错误与安全

- 不接受用户提交的任意远端 URL，避免 SSRF。
- 未知 ID 返回 404。
- 上游失败或返回非图片内容时返回结构化 502。
- 路由只暴露目录中本来已经公开的人像图片，并设置公共缓存。

## 验证

- 数据测试证明 `display_url` 稳定映射到本地代理。
- API 集成测试证明成功响应为 inline 图片，并覆盖未知 ID、非图片上游和上游失败。
- 静态契约测试覆盖所有人像可视入口使用 `display_url`。
- 运行相关单测、类型检查和生产构建。
