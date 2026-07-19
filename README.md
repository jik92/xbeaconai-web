# 曜作 AI 创作工作台

本地优先的 AI 创作应用：React Web、Hono OpenAPI、SQLite 任务存储、内存异步队列、SSE 进度，以及自动生成的 TypeScript SDK。

## 已实现

- 创作工作流：爆款二创、一键成片、口播脚本
- AI 工具箱：AI 创作、视频分割、素材理解、视频混剪、音色克隆、视频修复、字幕擦除、画质增强、爆款裂变
- 图片、视频、音频与多素材真实上传
- SQLite 任务持久化、进程恢复、取消、重试、幂等提交和部分成功
- SQLite 多账号、JWT 登录、注册、个人资料、密码和用户资源隔离
- 偏好设置、通知中心与本地 Mock 充值订单/余额完整链路
- 真实模型、FFmpeg 本地处理与显式 Mock 的逐阶段来源标记
- 可播放/查看/下载的结果文件
- OpenAPI 文档及 Hey API 生成的 TypeScript、Zod、TanStack Query SDK
- Seedance 2.0、Mini、Fast 三模型目录与显式选择；Wan 已从新任务路径移除
- 火山引擎 TOS 私有素材中转、流式分片上传、签名读取和终态清理

## 本地开发

```bash
bun install
bun run dev:all
```

也可以使用项目统一命令：

```bash
make run-dev
make lint
make test
make ci
```

`make ci` 会执行 Biome 格式/静态检查和单元测试；它不运行需要外部密钥、
TOS 或 FFmpeg 的专项能力测试。完整验证中的类型检查和生产构建仍可单独运行。

访问 `http://127.0.0.1:5173`。API 与 OpenAPI 默认位于 `http://127.0.0.1:8787`。

也可以分别运行：

```bash
bun run dev:api
bun run dev
```

## 生产方式启动

```bash
bun run build
cp .env.example .env
# 编辑 .env，至少设置一个随机且足够长的 JWT_SECRET
bun run start
```

访问 `http://127.0.0.1:8787`。服务默认只绑定回环地址，不对公网暴露。

### 从抖音导入素材

在“素材库”选择目标文件夹后，可使用“从抖音导入”粘贴公开的抖音 HTTPS 分享链接。该能力仅面向确认拥有下载、保存和使用授权的内容；不会登录平台、处理验证码或规避访问控制。导入结果会作为当前账号的私有 MP4 素材保存。

该功能需要本机具备 Playwright Chromium（首次使用或报浏览器不可用时执行）：

```bash
bun x playwright install chromium
```

仅支持受限的抖音域名与 MP4 视频，单个文件最大 500MB。平台拒绝访问或链接失效时，导入会失败并显示原因。

JWT 保存在浏览器 `localStorage` 中；请勿在页面中注入不受信任的脚本。生产启动会拒绝缺失 `JWT_SECRET` 的配置。充值功能明确为本地 Mock，不会产生真实扣款。

## SDK 与能力实测

```bash
bun run test:models
bun run test:tos
bun run test:ffmpeg
bun run api:spec
bun run api:generate
```

模型和 FFmpeg 只有在本机能力报告通过后才会进入真实/本地执行计划。Seedance 视频任务不会在失败后切换模型、回退 Wan 或静默 Mock；测试替身只在 `FORCE_MOCK=true` 的端到端环境启用。

Seedance 多模态参考还要求 `.env` 中配置 `TOS_ACCESS_KEY_ID`、`TOS_SECRET_ACCESS_KEY`、`TOS_REGION`、`TOS_ENDPOINT` 和私有 `TOS_BUCKET`。运行 `bun run test:tos` 会真实验证上传、Head、签名读取、未签名拒绝、删除和中断清理；任何一项失败都不能视为生产就绪。

生成物：

- OpenAPI：`openapi/openapi.json`
- TypeScript SDK：`src/api/generated/`
- 本机测试证据：`artifacts/api-tests/`（不提交 Git）
- 能力门禁：`.data/capabilities.json`、`.data/ffmpeg-capabilities.json`（不提交 Git）

## 完整验证

```bash
bun run typecheck
bun test tests/unit
bun run build
bun run e2e
```

当前真实接口和 Mock 边界见 `docs/api-capability-report.md`。
