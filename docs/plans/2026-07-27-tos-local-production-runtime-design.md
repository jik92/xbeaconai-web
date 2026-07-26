# TOS Local/Production 运行时与 Doctor 设计

## 目标

开发环境和生产环境使用同一个上海 Bucket `xbeacon-shanghai`，但通过不同的服务端网络路径访问：

- local：上海公网 Endpoint；
- production：上海内网 Endpoint；
- 浏览器和外部模型拿到的签名 URL：始终使用上海公网 Endpoint。

项目尚在开发中，不保留旧 `TOS_ENDPOINT` 或 `TOS_INTERNAL_ENDPOINT` 兼容逻辑。

## 配置模型

统一使用以下非敏感配置：

- `TOS_REGION`
- `TOS_BUCKET`
- `TOS_SERVER_ENDPOINT`：API/Worker 所在环境执行上传、下载、HEAD、清理时使用；
- `TOS_PUBLIC_ENDPOINT`：浏览器、Seedance、MediaKit、Qwen 等外部调用方使用的签名 URL Endpoint；
- `TOS_CORS_ORIGINS`：Doctor 必须在 Bucket CORS 中确认存在的 Origin 列表。

local 示例将 `TOS_SERVER_ENDPOINT` 和 `TOS_PUBLIC_ENDPOINT` 都配置为 `tos-cn-shanghai.volces.com`。生产部署脚本将 `TOS_SERVER_ENDPOINT` 配置为 `tos-cn-shanghai.ivolces.com`，并将公网 Endpoint 保持为 `tos-cn-shanghai.volces.com`。

生产启动不得使用代码默认值。Region、Bucket、两个 Endpoint 和 CORS Origin 必须全部显式配置；Server Endpoint 必须是内网域名，Public Endpoint 必须是公网域名，两个 Endpoint 必须与 Region 一致。

## Doctor 与发布保护

TOS Doctor 使用当前运行时配置完成以下检查：

1. 通过 Server Endpoint 对目标 Bucket 执行 `HEAD Bucket`；
2. 通过 Public Endpoint 对目标 Bucket 执行 `HEAD Bucket`；
3. 读取 Bucket CORS，确认 `TOS_CORS_ORIGINS` 全部存在，并允许 `GET`、`HEAD`、`PUT`；
4. 返回实际 Region、Bucket、Server/Public 路由摘要，不输出凭证；
5. 将 Doctor 状态绑定到当前 TOS 配置指纹。配置变化后，历史“可用”状态立即失效。

API 在生产启动时自动刷新 TOS Doctor。检测失败时 API 继续启动，管理入口仍可用，但所有依赖 TOS 的模块和上传入口保持禁用。Worker 在生产启动前执行同一检查；检测未通过时不开始消费任务，防止发布后才在任务中暴露上传错误。

local 不强制启动 Doctor，也不因未配置 TOS 阻止 Server/Worker 启动；管理员手动运行 Doctor 时按公网 Server Endpoint 检查。

## CORS

上海 Bucket 保留生产 IP `http://118.196.101.57:9000`，并增加：

- `http://127.0.0.1:5173`
- `http://localhost:5173`
- `http://127.0.0.1:4173`
- `http://localhost:4173`

不增加通配 Origin。允许方法为 `GET`、`HEAD`、`PUT`。

## 验证

- 单测覆盖 local 公网配置、production 内网强校验、无旧变量兼容、配置指纹失效和 Doctor 双 Endpoint/CORS 检查；
- 运行相关单测、完整单测、TypeScript 类型检查和生产构建；
- 使用隔离环境变量验证 local/prod 配置解析；
- 本地真实运行 TOS Doctor，确认通过上海公网访问 `xbeacon-shanghai`；
- 更新上海 Bucket CORS 后，对 local Origin 执行图片、音频、视频预检和 Range 请求；
- 对生产配置执行真实 Doctor，并确认 API、Worker 当前运行状态不受影响。
