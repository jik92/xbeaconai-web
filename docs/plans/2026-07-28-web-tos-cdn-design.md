# 前端 TOS 与 CDN 发布设计

## 目标

将 Vite 生产前端发布到独立的火山引擎 TOS Bucket，通过火山引擎 CDN 以
`https://app.xbeaconai.com` 对外提供服务。API 继续由 `https://api.xbeaconai.com` 提供，不把用户素材与
前端静态文件放入同一个 Bucket。

## 架构

- 在 `cn-shanghai` 创建独立的私有前端 Bucket，Bucket 名称优先使用 `xbeaconai-web-prod`。
- CDN 域名使用 `app.xbeaconai.com`，源站类型为火山引擎对象存储，通过跨服务授权访问私有 Bucket。
- `api.xbeaconai.com` 保持独立 API 域名，前端生产构建固定使用该地址。
- `app.xbeaconai.com` 使用 CDN 分配的 CNAME，并在 CDN 侧关联 HTTPS 证书、启用 HTTP 到 HTTPS 强制跳转。
- CDN 对没有文件扩展名的页面请求执行回源 URL 改写，统一回源 `/index.html`，支持 TanStack Router 的 SPA
  子路由刷新。

## 发布流程

- 提供独立的前端 CDN 发布脚本，并由现有 `deploy.sh` 在完整发布时复用。
- 构建时显式设置 `VITE_API_BASE_URL=https://api.xbeaconai.com`。
- 先上传带内容 hash 的 JS、CSS、图片等静态资源，校验对象，再最后覆盖根目录 `index.html`。
- 每次发布记录 Git SHA、构建时间和文件清单，并保留可恢复的上一版 `index.html`。
- 上传或校验失败时不得覆盖 `index.html`，现网继续使用上一版本。
- 不在发布时立即删除旧 hash 资源，确保旧页面和回滚仍可加载。

## 缓存

- `/assets/*` 使用一年缓存和 `immutable`。
- `index.html` 与 SPA 页面响应不长期缓存，要求重新验证。
- favicon、manifest 等非 hash 静态资源使用短缓存。
- 403、404 不缓存，避免云端配置修复后继续命中旧错误。
- 发布完成后刷新 `/` 与 `/index.html`；SPA 页面因不长期缓存，无需枚举所有业务路由。

## 回滚

- 发布前保存当前入口文件，并保留其对应的 hash 静态资源。
- 回滚只需恢复上一版 `index.html`，再刷新 CDN 入口缓存。
- 发布清单用于确认入口文件对应的 Git SHA 和资源集合。

## 验证

- 运行相关单元测试、`bun run typecheck` 和 `bun run build`，不主动运行 E2E。
- 验证 Bucket 私有性、对象大小、Content-Type 和 Cache-Control。
- 验证 CDN CNAME、HTTPS 证书、HTTP 跳转、根路径和真实 SPA 子路由。
- 验证 `api.xbeaconai.com` 健康接口及其对 `https://app.xbeaconai.com` 的 CORS 响应。
- 通过响应头确认 CDN 缓存行为，不以单纯 HTTP 200 作为完成依据。

