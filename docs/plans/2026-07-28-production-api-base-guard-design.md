# 生产前端 API Base 防错设计

## 问题

生产前端最近一次从本地手工构建时没有传入 `VITE_API_BASE_URL`。`apiBaseUrl()` 因此回退到当前页面 Origin，导致登录请求发往静态站点 `https://app.xbeaconai.com/api/auth/login`。该域名由 CDN 和 TOS 提供，不具备 API 反向代理能力，TOS 会返回 412。

正式 `deploy.sh` 已显式传入 `https://api.xbeaconai.com`，但运行时代码没有防止手工构建遗漏变量。

## 设计

- 保留 localhost 和直接 IP 访问时使用同源 API 的现有行为。
- 配置了 `VITE_API_BASE_URL` 时继续优先使用配置值。
- 未配置构建变量且页面域名是 `app.xbeaconai.com` 时，固定回退到 `https://api.xbeaconai.com`。
- 其他域名保持当前同源回退，避免改变本地或临时环境。
- 本次生产构建同时显式传入 `VITE_API_BASE_URL=https://api.xbeaconai.com`。

这样正式部署和运行时防护可以相互兜底，不需要将 `/api/*` 接入静态 CDN，也不依赖未进入请求链路的前端 Nginx。

## 验证

- 单元测试覆盖 localhost、直接 IP、显式配置、生产域名兜底和其他域名同源回退。
- 运行类型检查和生产构建，并检查产物包含 `api.xbeaconai.com`。
- 发布后确认 CDN 使用新 bundle。
- 对 `app.xbeaconai.com/api/auth/login` 和 `api.xbeaconai.com/api/auth/login` 分别发起无敏感信息的请求，确认前者仍是静态 TOS、后者是应用 API；再从 bundle 证明浏览器会选择后者。

## 安全

不保存或复用用户在对话中暴露的密码和 Bearer Token。用户应在修复完成后修改密码，以撤销已暴露会话。

