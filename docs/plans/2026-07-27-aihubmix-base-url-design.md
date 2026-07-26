# AIHubMix BASE URL 配置设计

## 目标

在管理员密钥管理中新增 AIHubMix `OPENAI_BASE_URL`，生产值设为
`https://api.inferera.com`。配置修改后立即用于 Doctor 和所有 AIHubMix 请求，无需重启。

## 设计

- 将 `OPENAI_BASE_URL` 注册为 AIHubMix 的非 secret 管理项，但仍使用现有加密凭证库存储。
- AIHubMix 客户端在每次请求时读取当前 `OPENAI_BASE_URL`，不在实例构造时缓存管理值。
- Doctor 要求 `OPENAI_KEY` 与 `OPENAI_BASE_URL` 同时存在，并在请求前校验 BASE URL 是 HTTPS URL。
- 删除 BASE URL 后明确报告缺少配置，不回退到旧地址。
- `.env.key` 导入导出、管理 API 和生成 SDK 复用现有凭证目录自动覆盖该字段。

## 验收

- 凭证列表可看到并保存 `OPENAI_BASE_URL`；
- 修改 BASE URL 后已有 AIHubMix 客户端实例使用新地址；
- Doctor 对缺失或非法 URL 返回明确结果；
- 单测、类型检查、生产构建通过；
- 生产保存 `https://api.inferera.com` 后，Doctor 通过 HTTP 返回逐项结果，不再出现 502。
