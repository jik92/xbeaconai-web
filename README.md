# 烽火 AI 创作工作台

React Web、Hono API、SQLite、BullMQ/Redis 和独立 Worker 组成的本地优先 AI 创作应用。

> 本文件是项目知识库入口。开始任何开发任务时先读本页，再按任务类型进入 `docs/`；不要一次性读取全部文档。

## 按任务路由知识

| 你要做什么 | 先读 | 按需继续读 |
| --- | --- | --- |
| 了解项目或启动开发环境 | [docs/project/overview.md](docs/project/overview.md) | [本地开发](docs/project/getting-started.md)、[架构](docs/project/architecture.md) |
| 新增或改造功能 | [docs/features/README.md](docs/features/README.md) | [功能地图](docs/project/feature-map.md)、相关 `docs/plans/`、目标 Feature/Job 文档 |
| 改 API、数据、上传或鉴权 | [架构](docs/project/architecture.md) | 相关 Store/API 源码、功能文档 |
| 新增、维护或排查异步 Job | [Worker 索引](docs/worker/README.md) | [Job 索引](docs/worker/jobs/README.md) 中对应 Handler 文档 |
| 修复 Bug | [docs/bugs/README.md](docs/bugs/README.md) | 受影响功能、Worker/API 文档和已有 Bug 档案 |
| 音色克隆 | [音色克隆专题](docs/voice-clone-development.md) | [voice-clone Job](docs/worker/jobs/voice-clone.md) |
| 查阶段性设计或实施决策 | [docs/plans/](docs/plans/) | 与当前代码核对，长期事实以 `docs/project/` 为准 |

完整文档导航在 [docs/README.md](docs/README.md)。

## 最小启动与验证

```bash
bun install
make run-server
# 另开终端
make run-worker
```

也可使用 `make run-dev`。Web：`http://127.0.0.1:5173`；API/OpenAPI：`http://127.0.0.1:8787`、`/openapi.json`。

开发启动时，三个进程会继续输出到终端，并分别追加到以下不提交 Git 的日志文件：

- `logs/web.log`
- `logs/api.log`
- `logs/worker.log`

可通过 `YAOZUO_LOG_DIR` 改为其他本地日志目录。

常用验证：`make ci`、`bun run typecheck`、`bun run build`、`bun run e2e`。配置项以 `.env.example` 为准；不要提交或回显密钥。

## FFmpeg 与 Playwright 运行依赖

FFmpeg 属于系统依赖，macOS 与 Ubuntu 不要求二进制版本完全相同，但必须通过同一组项目能力检查。
Playwright 的 npm 包版本由 `bun.lock` 锁定；Chromium 等浏览器文件按操作系统和运行账号单独安装，不随
`bun install` 或 Git 代码自动同步。Playwright 下载的专用 FFmpeg 不能替代 Worker 使用的系统 FFmpeg。

### 当前同步状态

以下是 2026-07-27 对本地开发机和 `TITOK-PROD-001` 的实测结果：

| 项目 | 本地 macOS | 生产 Ubuntu 24.04 | 结论 |
| --- | --- | --- | --- |
| FFmpeg / FFprobe | `ffmpeg-full 8.1.2_1` | `6.1.1-3ubuntu5` | 平台版本不同，属于预期 |
| `subtitles/libass`、中文字体 | 可用 | `libass9`、`fonts-noto-cjk` 可用 | 能力同步 |
| `drawtext`、`overlay`、`scale`、`concat` | 可用 | 可用 | 能力同步 |
| `libx264`、AAC 编码 | 可用 | 可用 | 能力同步 |
| Playwright 包 | `1.61.1` | `1.61.1` | 版本同步 |
| Playwright Chromium | `149.0.7827.55`，可启动 | `149.0.7827.55`，可启动 | 版本与能力同步 |
| Playwright Linux 运行库 | 不适用 | Playwright 官方依赖已安装 | 已同步 |

### 安装依赖

macOS 本地开发机：

```bash
brew install ffmpeg-full
export PATH="$(brew --prefix ffmpeg-full)/bin:$PATH"
bun install --frozen-lockfile
bun x playwright install chromium
```

Ubuntu 生产机在项目目录执行：

```bash
bun install --frozen-lockfile
sudo bash deploy/install-media-dependencies.sh
```

Playwright 浏览器缓存位于当前账号的缓存目录。生产环境必须用实际运行 API 的账号执行安装；否则即使另一个
账号已经下载 Chromium，服务进程仍可能报 `Executable doesn't exist`。当前生产服务使用 root 账号时，缓存目录为
`/root/.cache/ms-playwright/`。

### 一致性检查

每次更换服务器、升级 FFmpeg、修改 Bun 锁文件或更新 Playwright 后执行：

```bash
# 项目要求的 FFmpeg subtitles/libass 与中文字体检查
bun scripts/check-ffmpeg-production.ts

# 版本、关键滤镜和编码器检查
ffmpeg -version
ffprobe -version
ffmpeg -hide_banner -filters | grep -E 'subtitles|drawtext|overlay|scale|concat'
ffmpeg -hide_banner -encoders | grep -E 'libx264|aac'

# Playwright 包、已安装浏览器和真实启动检查
bun x playwright --version
bun x playwright install --list
bun scripts/check-playwright-production.ts
```

生产 Worker 的 systemd 单元会在启动前运行 `scripts/check-ffmpeg-production.ts`；`deploy.sh` 会安装锁文件对应的
Chromium 及 Linux 依赖，并在停止现有服务前运行真实浏览器启动检查。若检查失败，先执行
`deploy/install-media-dependencies.sh`，不要跳过预检或以 Playwright 自带 FFmpeg 代替系统依赖。

## 不可跨越的边界

- `web/` 只负责 UI 和 API SDK 调用；`server/` 只处理 HTTP、鉴权、持久化和任务投递；`worker/` 执行异步业务并回写 SQLite。
- 任务消息仅使用 `shared/jobs/queue-contract.ts`，持久化状态以 SQLite 为准；不要以进程内 Promise、Map 或 Server 后台任务替代 BullMQ。
- 每个专用 Job 都是 `worker/jobs/job-*.ts` 中的独立 Handler；其阶段/输出定义在 `worker/jobs/definitions/<module>.ts`。新增或修改 Job 必须更新对应的 Worker 文档。
- `web/api/generated/`、`openapi/openapi.json` 和 `drizzle/meta/` 是生成物，不能手改。
