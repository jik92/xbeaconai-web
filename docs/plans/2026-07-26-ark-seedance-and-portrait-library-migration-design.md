# Ark Seedance 全量迁移与双来源人像库设计

## 目标

将仓库内所有 Seedance 视频生成从 AIHubMix 全量迁移到火山方舟 Ark 原生 API，并完整移除 AIHubMix 的视频生成能力。人像库同时支持官方通用虚拟人像和用户自建虚拟人像，两类人像均通过 `asset://<AssetId>` 参与 Seedance 推理。

## Provider 迁移

- `SeedanceVideoJob` 的任务创建、状态查询、取消核对和结果下载统一调用 `ArkSeedanceClient`。
- Ark 客户端支持图片、视频和音频参考，分别生成 `reference_image`、`reference_video` 和 `reference_audio` 原生内容项。
- 模型目录、SDK 注册、能力报告、任务执行计划和 Provider 审计统一使用 Provider `ark` 与实现名 `ark-seedance-video`。
- AIHubMix 保留文本、图像分析、图像生成和音频生成能力；删除其 Seedance 类型、请求构造、创建、轮询、取消和下载方法。
- 生产代码不得保留 Seedance 到 AIHubMix 的兜底或功能开关。

## 人像引用契约

使用显式判别联合：

```ts
type PortraitReference =
  | { type: "general"; portraitId: number }
  | { type: "custom"; assetId: string };
```

历史项目中的数字 `portraitId` 在读取时归一化为 `general`，避免旧数据失效。前端只提交本地人像标识；Server 和 Worker 根据用户与持久状态解析 Ark Asset ID，不信任客户端提交的 `asset://` URI。

## 通用虚拟人像

- 继续使用现有 1,125 条官方人像清单。
- 从每条 `source_url` 提取官方 Asset ID，并在服务端形成稳定的 `asset://` URI。
- UI 仍使用公开缩略图预览；Seedance 请求不再发送公开图片 URL。

## 自建虚拟人像

- 用户在人像库上传图片，图片进入现有私有 TOS 与本地素材记录。
- 新增 Ark 人像组和人像资产持久表，保存 owner、Project、Group ID、Asset ID、状态、错误和更新时间。
- API Server 只创建记录并投递 BullMQ；Worker 创建或复用该用户的 Ark Asset Group，调用 `CreateAsset` 并轮询 `GetAsset`。
- 状态包括 `pending`、`processing`、`active` 和 `failed`。只有 `active` 可用于 Seedance；失败可显式重试。
- 上传与查询使用 `default` Project，确保与当前 Ark API Key 所属 Project 一致。
- 删除本地自建人像不隐式删除共享 Group；远端 Asset 删除需作为明确操作处理。

## 页面与交互

- 人像库增加“通用虚拟人像 / 自建虚拟人像”来源切换。
- “新建人像”打开上传 Modal，并展示上传与入库进度。
- 自建人像卡片显示处理中、可使用和失败状态；处理中与失败资产不可选择。
- 一键成片与其他人像选择器统一消费两类人像选项，并标明来源。

## 模块门禁与兼容

- Seedance 模型以 Ark 凭据健康状态决定是否可用。
- 同时依赖 AIHubMix 分析能力的模块继续检查 AIHubMix，但视频模型本身只检查 Ark。
- 旧的运行中 AIHubMix Seedance 任务不尝试交给 Ark 接管；恢复时返回明确的旧 Provider 不兼容错误，避免用相同任务 ID 查询错误上游。

## 测试与验收

- 数据库迁移与 owner 隔离测试。
- 通用人像 `portraitId -> asset://AssetId` 契约测试。
- 自建人像上传、异步状态、失败重试、Active 门禁与 Worker 恢复测试。
- 三款 Seedance Ark 原生请求测试，覆盖图片、视频、音频和人物参考。
- 搜索证明生产代码不存在 AIHubMix Seedance 调用或 `aihubmix-video` 实现名。
- 更新 OpenAPI 与生成 SDK，运行 `make ci`、类型检查和生产构建。
- 分别使用通用人像和自建人像执行真实视频生成测试。

## 安全与幂等

- 所有资源按 owner 隔离，Server 不信任前端 owner 或 Ark Asset URI。
- Ark Asset Group、Asset 和视频创建均防止重复提交；只读查询允许有限重试。
- Ark Key、AK/SK、签名 URL 和生成产物不进入源码、日志或 Git。
- Provider 不可用时明确失败，不静默回退 AIHubMix 或 Mock。
