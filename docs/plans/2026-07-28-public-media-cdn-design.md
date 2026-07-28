# 公共素材 CDN 与预览图设计

## 目标

让素材库中的图片、视频和音频使用 `https://files.xbeaconai.com` 长期公开 URL，避免预览组件把素材转换为
`blob:` 地址。图片展示使用压缩预览，下载和全尺寸查看使用原文件，二者具有明确且稳定的 URL 语义。

## 架构

- `files.xbeaconai.com` 使用火山引擎 CDN，源站为生产素材 Bucket `xbeacon-shanghai`。
- CDN 通过回源鉴权读取私有 TOS，Bucket 不改为匿名 public-read，避免用户绕过 CDN 规则直接访问 TOS。
- API 只向已登录用户返回其有权查看的素材记录，但记录中的媒体 URL 是长期公开 CDN URL。
- 新旧素材沿用当前对象 Key，不复制、不重命名、不迁移对象。
- 图片、视频和音频均通过 CDN 原文件 URL 加载；仅图片增加 TOS 图片处理参数。

## URL 语义

- 原文件：`https://files.xbeaconai.com/{encoded-object-key}`
- 图片预览：`https://files.xbeaconai.com/{encoded-object-key}?x-tos-process=style/preview`
- `preview` 样式限制长边为 1280 像素，使用约 80 的质量并输出 WebP。
- 素材卡片和普通图片预览使用预览 URL；全屏原图和下载使用原文件 URL。
- 视频、音频不增加图片处理参数，直接使用原文件 URL，并保留 Range 请求。

## 防盗链与缓存

- CDN Referer 白名单允许 `https://app.xbeaconai.com/*` 及批准的本地开发 Origin。
- 拒绝空 Referer，降低公开链接被直接粘贴和普通站点盗链的风险；Referer 可伪造，不作为权限边界。
- 原文件和图片预览分别缓存，缓存键必须包含 `x-tos-process`。
- 原文件和成功的预览响应使用长缓存；4xx、5xx 不长期缓存。
- 开启 HTTPS，并配置流量告警和用量封顶，避免公开视频产生不可控流量费用。

## 兼容与错误处理

- 本地开发默认仍可使用受鉴权 API 内容地址；只有配置公共素材域名时才返回 CDN URL。
- 若公共域名或 CDN 尚未就绪，生产启动和部署检查必须失败，不静默退回 `blob:`。
- 下载逻辑不再为了鉴权把公共素材读取为 Blob；非素材接口的受鉴权下载保持现状。
- CSP 的图片与媒体来源显式允许 `https://files.xbeaconai.com`，不扩大到任意媒体域名。

## 验证

- 单元测试覆盖对象 Key 编码、原图与预览 URL、图片处理参数、媒体类型分流和前端不再创建素材 Blob。
- 运行相关测试、`bun run typecheck` 和 `bun run build`，不运行 E2E。
- 云端验证 DNS、CDN CNAME、HTTPS、回源、Range `206`、图片预览格式与尺寸、缓存键和 Referer 允许/拒绝。
- 生产发布后，从真实素材 API 响应中取得 URL，并分别验证原文件、预览图、应用 Referer 和空 Referer。
