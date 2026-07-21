# Provider 非敏感默认配置集中化设计

## 目标

从 `.env` 移除全部 `OPENAI_*`、`VOLC_*`、`TOS_*` 非敏感运行参数，统一在 `web/app/config.ts` 中维护默认值。Provider 凭证继续保存在 `.env.key` 和加密 SQLite 中。

## 配置边界

`APP_CONFIG.providerDefaults` 包含：

- OpenAI-compatible Base URL 与视频分析模型。
- 火山语音 Base URL、克隆/TTS 资源 ID、轮询间隔和超时。
- TOS Region、Endpoint 与 Bucket。

这些值会进入浏览器构建产物，因此不得包含 API Key、Secret、JWT、签名或其他敏感信息。`BYOK_ENCRYPTION_KEY` 继续保留在 `.env`，六项 Provider Key 继续保留在 `.env.key`。

## 运行路径

- Server 和 Worker 通过 `server/env.ts` 引用 `APP_CONFIG.providerDefaults`，不再读取对应环境变量。
- `.env.example` 删除相关字段，避免部署人员误以为可以覆盖。
- 本机 `.env` 中对应字段安全删除，不输出其值。
- 测试与 E2E 不再注入已失效的 TOS Provider Key 环境变量。

## 验证

- 静态审计确认运行代码不再读取 `process.env.OPENAI_*`、`process.env.VOLC_*`、`process.env.TOS_*`。
- 确认 `.env` 和 `.env.example` 不再包含这些字段，`.env.key` 仍被忽略。
- 运行类型检查、单测、构建和 E2E。
