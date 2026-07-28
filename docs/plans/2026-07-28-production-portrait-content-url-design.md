# 生产人像内容 URL 修复设计

## 问题

生产 Web 已由 `app.xbeaconai.com` 的静态 CDN 承载，但内置人像仍使用相对地址
`/api/portraits/{id}/content`。浏览器因此向静态 CDN 请求图片，CDN 将该路径回退为 SPA 的
`index.html`，导致全部内置人像预览收到 HTML 而不是图片。

实际 API 域名 `api.xbeaconai.com` 上的同一路由仍能正常返回经过校验的图片内容，因此不需要修改人像数据、
API 路由或上游对象存储。

## 方案

让 `portraitDisplayUrl()` 复用现有 `apiUrl()`，使生产环境生成
`https://api.xbeaconai.com/api/portraits/{id}/content`，本地开发仍按现有 API base 规则工作。
所有调用 `portraitDisplayUrl()` 的人像库和视频工作流会同时恢复，不新增第二套域名判断。

## 验证

- 更新 URL 单元测试，覆盖人像记录解析与统一 API base 行为。
- 运行相关单元测试、`bun run typecheck` 和 `bun run build`。
- 发布 Web 后请求实际生产 API 人像地址，确认状态码、MIME 类型和文件签名均为图片。

## 非目标

- 不让静态 CDN 回源 `/api/*`。
- 不改 API、数据库、人像目录或上游 TOS 地址。
- 不把上游人像 URL 直接暴露给前端。
