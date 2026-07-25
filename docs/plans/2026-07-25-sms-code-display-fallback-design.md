# 短信凭证缺失时验证码回显设计

## 目标

优先保证注册和重置密码流程可用。当火山短信所需的 Access Key 未完整配置时，无论开发或生产环境，均不调用短信服务，而是通过现有接口字段向前端返回验证码。

## 行为边界

- `TOS_ACCESS_KEY_ID` 或 `TOS_SECRET_ACCESS_KEY` 任一缺失：本次投递进入 `display` 模式，验证码写入数据库并返回前端。
- 两项凭证均存在：本次投递进入 `sent` 模式，调用火山短信，接口不返回验证码。
- 凭证存在但上游鉴权失败、模板错误、网络失败或服务异常：保持现有错误处理，返回 `503 SMS_PROVIDER_ERROR`，不得静默回显验证码。
- 每次请求动态读取密钥管理，管理员新增或删除凭证后无需重启。

## 实现方案

让 `SmsSender.send` 返回本次投递结果 `sent` 或 `display`。`ConfiguredVolcSmsSender` 在凭证缺失时返回 `display`，凭证完整且发送成功时返回 `sent`；真实发送失败仍抛出 `SmsProviderError`。

`AccountStore.sendSmsCode` 根据投递结果决定是否在响应中加入 `verificationCode`。不再通过运行环境决定是否回显验证码。发送器抛错时继续删除刚写入的验证码记录，避免生成不可用验证码。

前端已经支持可选的 `verificationCode` 字段并显示“当前验证码”，无需调整 UI 或新增文案。

## 测试

- 缺少全部凭证时返回 `display`，且不发起网络请求。
- 仅缺少任一凭证时返回 `display`。
- 凭证完整并发送成功时返回 `sent`。
- 凭证完整但服务商失败时继续抛出错误。
- AccountStore 在 `display` 模式返回验证码，在 `sent` 模式不返回验证码。
- 运行相关单元测试、`bun run typecheck` 和 `bun run build`；按仓库规则不运行 E2E。
