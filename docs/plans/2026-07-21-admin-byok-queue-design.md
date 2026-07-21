# 管理后台、BYOK 与全量队列设计

## 目标

新增仅管理员可访问的 `/admin` 页面，支持维护系统级外部服务凭证，并用 DataTable 查看所有用户的队列任务。管理员邮箱在 `web/app/config.ts` 中显式配置，默认包含 `zuo.zhong@163.com`。

## 权限

- 前端只对管理员显示入口，并在路由层阻止普通用户进入。
- 后端以当前登录用户的规范化邮箱校验管理员白名单，所有 `/api/admin/*` 接口统一返回 `403`。
- UI 隐藏不是安全边界；后端校验是权威执行路径。

## BYOK 凭证库

- SQLite 新增 `provider_credentials` 表，允许的字段为：
  - `OPENAI_KEY`
  - `VOLC_SPEECH_API_KEY_ID`
  - `VOLC_SPEECH_API_KEY`
  - `TOS_ACCESS_KEY_ID`
  - `TOS_SECRET_ACCESS_KEY`
  - `MEDIAKIT_API_KEY`
- 每项凭证使用 `BYOK_ENCRYPTION_KEY` 通过 AES-256-GCM 独立加密，保存密文、随机 nonce、认证标签、更新人和更新时间。
- API 只返回是否配置、末四位掩码和更新时间，永不返回明文、密文、nonce 或认证标签。
- 更新使用事务；空输入不修改，明确删除才清除已有值。
- Provider 在执行新请求时从共享 SQLite 凭证库读取，Server 与 Worker 更新后无需重启。
- Provider 缺少凭证时明确失败，不从业务 `.env` 静默回退，也不自动切换 Mock。
- JWT、Redis、Base URL、模型、资源 ID、TOS Region/Endpoint/Bucket 等基础配置继续由 `.env` 管理。

## 初始化导入

- 新增 `bun run byok:import-env`。
- Bun 从当前 `.env` 加载允许的凭证字段，脚本校验主密钥后幂等 upsert 到 SQLite。
- 导入过程只输出字段名和状态，不打印明文或掩码，不修改 `.env`。

## 管理页面

- `/admin` 提供“密钥管理”和“队列任务”两个 Tab。
- 密钥按 AIHubMix、火山语音、TOS 和 MediaKit 分组，展示状态、末四位掩码和更新时间；输入框不回填明文。
- 队列任务复用 `web/components/ui/data-table.tsx`，服务端分页，默认按创建时间倒序。
- 列包含任务 ID、用户邮箱、模块、标题、状态、进度、阶段、执行模式、Provider、创建和更新时间。
- 支持状态、模块、用户邮箱筛选，点击任务查看错误和 Provider 详情。
- 本期队列表只读，不提供取消、重试、删除或队列清理。

## 错误处理与审计

- 生产模式缺少或无法解析 `BYOK_ENCRYPTION_KEY` 时拒绝启动；开发模式管理接口和真实 Provider 明确报告不可用。
- 更新审计只记录字段名、操作者和时间，不记录任何密钥内容。
- 已提交到上游的任务继续原流程，新请求使用最新凭证。

## 验证

- 加密往返、错误主密钥、掩码、更新/删除和日志脱敏单测。
- 管理员与普通用户接口隔离测试。
- `.env` 幂等导入测试。
- Server 和 Worker 动态凭证读取测试。
- 全量任务分页、筛选及用户邮箱关联测试。
- `1440x900`、`1024x768` 管理后台 E2E。
- API 契约生成、数据库迁移检查、类型检查、单测、构建和全量 E2E。

