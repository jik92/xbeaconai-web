# 生产 Playwright 依赖保障设计

## 目标

修复 `TITOK-PROD-001` 缺少 Playwright Chromium 和 Linux 运行库的问题，确保抖音下载等运行时浏览器功能可用，
并防止后续部署或 Playwright 版本升级后静默回退到不可用状态。

## 设计

- 立即使用生产 API 服务的 root 账号执行 `bun x playwright install --with-deps chromium`，让浏览器文件写入
  `/root/.cache/ms-playwright/`，并安装 Playwright 官方要求的 Ubuntu 运行库。
- 新增生产 Playwright 预检脚本，实际启动 headless Chromium、读取版本并关闭浏览器；仅检查文件存在不算通过。
- 部署脚本在安装 Bun 依赖后确保 Chromium 与系统运行库已安装，并在停止或替换现有服务前完成真实启动预检。
- `deploy/install-media-dependencies.sh` 同步覆盖 FFmpeg 与 Playwright，供换机和人工修复复用。
- 不改用系统 Chromium，不新增 `executablePath`，避免 Playwright npm 包与浏览器版本脱节。

## 错误处理

- 浏览器下载、系统依赖安装或真实启动任一步失败，部署立即失败。
- 预检安排在生产构建和服务替换前，失败时继续保留当前运行服务。
- 预检不访问外部业务页面，不读取或输出任何业务密钥。

## 验收

- 本地预检能启动锁文件对应的 Chromium。
- 生产 `bun x playwright install --list` 能看到 Chromium 1228，并能真实启动 Chromium 149。
- FFmpeg production check 继续通过。
- API、Worker、Nginx、Redis 和公网 Web/API 健康检查均正常。
- README 记录平台差异、安装方法、当前状态和验收命令。
