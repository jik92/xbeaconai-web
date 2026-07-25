# Ark TypeScript Seedance 虚拟人像测试设计

## 目标

在不改变现有 AIHubMix 生产链路的前提下，增加一个直接调用火山方舟原生视频生成接口的 TypeScript 客户端，并使用当前方舟账号中的虚拟人像资产完成一次 Seedance 2.0 Mini 实测。测试成功后将视频保存到本地结果目录和桌面，供人工检查人物参考是否生效。

## 范围

- 新增独立的 Ark Seedance TypeScript 客户端，调用 `https://ark.cn-beijing.volces.com/api/v3`。
- 使用 `POST /contents/generations/tasks` 创建任务，使用 `GET /contents/generations/tasks/{id}` 查询任务。
- 支持文本和 `asset://` 图片资产组成的多模态 `content`，图片角色使用 `reference_image`。
- 新增独立的 `ARK_API_KEY` 凭据定义，沿用项目现有加密凭据存储，不覆盖 `OPENAI_KEY`。
- 新增真实测试脚本和请求构造单元测试。
- 将成功视频下载到 `.data/results/` 与用户桌面，并通过 FFprobe 核对实际媒体参数。

## 非目标

- 不替换现有 AIHubMix Provider。
- 不修改一键成片、AI 视频生成或 Worker 的生产路由。
- 不自动降级模型、Provider 或 Mock。
- 不提交 API Key、生成视频或其他本地产物。

## 客户端设计

新增 `server/providers/ark-seedance.ts`：

- 使用原生 `fetch`，避免引入并不存在的火山官方 TypeScript SDK 依赖。
- 暴露类型明确的任务创建、任务查询、轮询和下载方法。
- 创建请求不自动重试，避免外部付费任务被重复提交。
- 查询请求允许对短暂网络错误进行有限重试。
- 终态包含 `succeeded`、`failed`、`cancelled` 和 `expired`；失败时保留上游错误信息但不泄露认证头。
- 构造函数允许注入 base URL、API Key 与 fetch 实现，便于单元测试；默认从加密凭据存储读取 `ARK_API_KEY`。

本次真实请求使用：

- 模型：`doubao-seedance-2-0-mini-260615`
- 人物资产：`asset://asset-20260224201548-dthqc`
- 图片角色：`reference_image`
- 提示词：`固定机位，近景。图片1中的人物面对镜头微笑并轻轻挥手。人脸清晰，无字幕。`
- 分辨率：`720p`
- 比例：`3:4`
- 时长：`5`
- 音频：关闭
- 水印：关闭

## 测试与输出

单元测试验证请求体完整保留 `asset://` 地址、`reference_image` 角色及生成参数，并验证创建接口不会发生隐式重试。真实测试脚本只提交一次任务，随后轮询至终态；成功后下载视频，同时输出任务 ID、视频地址和本地文件位置。

验证顺序：

1. 运行新增单元测试。
2. 运行 `bun run typecheck`。
3. 运行 `bun run build`。
4. 将用户提供的 Ark Key 写入加密凭据存储。
5. 执行一次真实虚拟人像任务。
6. 使用 FFprobe 核对时长、分辨率、编码和音轨，并抽帧检查人物参考效果。

## 安全与失败处理

- API Key 不写入源码、命令输出、测试快照或 Git 历史。
- 上游若拒绝资产、模型或账号权限，立即报告真实错误，不改用公开图片或其他 Provider 重试。
- 视频 URL 和生成文件视为临时测试产物，不加入版本控制。
