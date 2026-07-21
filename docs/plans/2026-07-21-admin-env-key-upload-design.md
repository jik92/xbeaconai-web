# 管理后台 `.env.key` 上传与紧凑布局设计

## 目标

管理后台支持上传第三方开发者自行配置的 `.env.key`，批量覆盖系统 BYOK Provider 凭证；同时移除页面抬头，将 Tab、上传入口、参数和队列表统一收进一个紧凑容器。

## 配置边界

- `BYOK_ENCRYPTION_KEY`、JWT、Redis、数据库及 Provider 非敏感配置继续保留在 `.env`。
- `.env.key` 只允许以下字段：`OPENAI_KEY`、`VOLC_SPEECH_API_KEY_ID`、`VOLC_SPEECH_API_KEY`、`TOS_ACCESS_KEY_ID`、`TOS_SECRET_ACCESS_KEY`、`MEDIAKIT_API_KEY`。
- 真实 `.env.key` 加入 `.gitignore`；仓库提交空值模板 `.env.key.example`。
- 当前本地 `.env` 中的白名单字段一次性安全迁移到 `.env.key` 并从 `.env` 删除，不在输出或 Git diff 中暴露值。

## 上传流程

- 前端只接受 `.env.key`，通过 multipart 上传原文件，不在 React 状态中解析或展示内容。
- 服务端限制文件大小、文件名和文本格式，只解析白名单字段；上传内容不落盘、不记录日志。
- 非空字段覆盖现有加密凭证，缺失或空字段保持原值；未知字段忽略并按字段名报告。
- 响应仅返回更新、跳过和忽略的字段名，不返回明文、密文或掩码。
- 权限沿用服务端管理员邮箱校验；所有凭证仍通过 AES-256-GCM 保存到 SQLite，并对新请求即时生效。
- 本地导入脚本默认读取 `.env.key`；保留原命令别名以兼容现有工作流。

## 页面布局

- 删除 `ADMIN CONSOLE`、页面标题和描述抬头。
- 页面主体只有一个白色容器，最大化利用工作区高度。
- 容器顶栏左侧为“密钥管理 / 队列任务”Tab，右侧为“导入 .env.key”按钮。
- 安全提示压缩为单行；Provider 分组、参数行、输入和按钮降低高度与间距。
- 密钥列表或 DataTable 在容器内容区内部滚动，容器自身不撑开页面。
- 在 `1440x900` 和 `1024x768` 保持上传入口、Tab 和内容区可用。

## 验证

- `.env.key` 解析白名单、空值、未知字段、重复字段、非法格式和大小限制测试。
- 管理员上传成功与普通用户 403 测试；API 响应和日志不包含明文。
- 本地配置迁移后验证 `.env` 不再包含 Provider Key，`.env.key` 被 Git 忽略。
- OpenAPI/SDK、类型检查、单测、构建及桌面/平板 E2E。
