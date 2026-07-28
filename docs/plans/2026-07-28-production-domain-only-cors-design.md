# 生产环境仅域名 CORS 设计

## 问题

生产 `/etc/xbeaconai-web.env` 的 `TOS_CORS_ORIGINS` 仍包含已停用的 `http://118.196.101.57:9000`，而素材 Bucket 当前规则没有该 Origin。TOS Doctor 按生产配置检查时因此报告旧 IP 缺少 GET、HEAD、PUT。

`deploy.sh` 也会在每次部署时把旧 IP 重新写入 TOS 和 API 的 Origin 列表，单独修改线上 Bucket 不能持久解决。

## 设计

- 生产 `TOS_CORS_ORIGINS` 只保留 `https://app.xbeaconai.com`。
- 生产 API 的 `ALLOWED_ORIGINS` 只保留 `https://app.xbeaconai.com`。
- `deploy.sh` 不再将直接 IP 写入上述两个安全边界。
- 启用 TLS 时，部署只验证 `app.xbeaconai.com` 与 `api.xbeaconai.com`；直接 IP 的 9000 端口检查只保留在无 TLS 回退分支，不再作为正式生产入口。
- Bucket 保持私有，仅配置一个包含正式域名、GET、HEAD、PUT 和现有响应头的规范 CORS 规则。

## 兼容性

正式域名的登录、API、TOS 上传、预览和 Range 下载不变。localhost 和直接 IP 不再被生产 TOS/API 视为允许的跨域 Origin，符合域名专用要求。无 TLS 回退端口仍可用于服务器静态诊断，但不承诺浏览器直传 TOS。

## 验证

- 更新部署与 CORS 单元测试，确保生产配置不再出现旧 IP。
- 运行类型检查和生产构建。
- 更新生产 env 和 Bucket 后，回读精确规则。
- 使用 `https://app.xbeaconai.com` 实测签名 PUT 200、GET 200、Range 206。
- 运行 TOS Doctor，并确认 API、Worker、Nginx、Redis 正常。

