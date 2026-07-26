# 生产发布构建恢复设计

## 目标

恢复 `deploy.sh` 的标准发布链路，使 `main` 可以在 `TITOK-PROD-001` 的
`/root/build/xbeaconai-web` 中完成依赖安装、生产构建、服务重启和 Nginx 发布，并让
`http://118.196.101.57:9000/` 的页面与同源 API 可实际使用。

## 方案

保留 `deploy.sh` 当前的完整构建门禁，不通过跳过 TypeScript 检查来掩盖主干错误。修复当前四类构建阻塞：

- 让千川投放持久化对象满足 Drizzle JSON 字段类型；
- 让待开放页面接受已有的投放功能 ID；
- 统一千川创意 ID 的数据库可空类型；
- 在 OpenAPI 3.1 导出时把旧式布尔 `exclusiveMinimum` 规范化为数值，确保 SDK 生成有效 Zod 代码。

修复后重新导出 OpenAPI、生成 SDK，运行相关单测、类型检查和生产构建。验证通过后提交并推送
`main`，在远端运行仓库自带的 `deploy.sh`。

## 验收

- 本地 `bun run typecheck` 与 `bun run build` 成功；
- 远端 `deploy.sh` 成功结束，远端 `HEAD` 等于 `origin/main`；
- API、Worker、Redis 和 Nginx 均为 active；
- 公网 `http://118.196.101.57:9000/` 返回 HTML，`/api/health` 返回预期 JSON；
- 至少验证一个前端路由通过同一公网入口可访问。
