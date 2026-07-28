# Provider 功能状态缓存防护设计

## 问题

登录用户进入应用时会请求 `/api/provider-features`。普通浏览器可能复用旧版本响应；当前前端只判断响应对象是否存在，却直接读取 `data.modules[moduleId]`。当旧响应缺少 `modules` 时，React 根节点异常退出并显示 `Cannot read properties of undefined (reading 'video-remix')`。无痕窗口未登录，不会触发这条查询，因此页面正常。

`app.xbeaconai.com` 的前端入口由 CDN 和 TOS 提供，不经过生产 Nginx；只修改前端域名的 Nginx 不能修复此问题。

## 设计

采用应用端和服务端双重防护：

- API 的 Provider 功能状态响应设置 `Cache-Control: private, no-store`，禁止浏览器或共享缓存保存用户相关运行时状态。
- 前端请求显式使用 `cache: "no-store"`，绕过浏览器中已有的旧响应。
- 前端在把响应交给 React Query 前校验 `modules` 和 `operations`；结构不完整时将其作为查询错误处理。
- `moduleProviderAvailability` 对缺少 `modules` 的数据安全返回 `undefined`，让功能门显示现有的“状态暂时无法确认”提示，而不是让整个应用崩溃。

## 错误处理与兼容性

接口结构正确时行为不变。接口不可用或返回旧结构时，侧边栏不展示未经确认的运行时模块，目标页面显示功能状态错误提示；用户账户、静态菜单配置和其他页面保持可用。

## 验证

- 单元测试覆盖完整响应、缺少 `modules` 的旧响应以及请求禁用缓存。
- 运行相关单测、类型检查和生产构建。
- 发布后用生产登录态实测 `/api/provider-features` 的响应结构和 `Cache-Control`，并确认 CDN 加载新 bundle。

