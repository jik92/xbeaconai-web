# 全站浏览器媒体 CDN 与图片分级预览设计

## 目标

浏览器展示、播放、预览和下载的所有图片、音频与视频统一使用
`https://files.xbeaconai.com` 或已经由 `https://app.xbeaconai.com` Web CDN 承载的非媒体界面资源。
业务媒体不得继续使用 API 二进制响应、签名 TOS 地址、第三方源地址、Blob URL 或媒体 Data URL。

Server、Worker 与模型供应商之间的内部素材传输不强制使用公共 CDN，避免 Referer 防盗链影响模型取材。
不保留旧页面依赖媒体 API 内容地址的兼容加载路径。

## 当前遗漏

- 1125 张内置人像通过 `api.xbeaconai.com/api/portraits/{id}/content` 由 API 实时代理上游图片。
- 47 张内置场景图由 Web CDN 加载原始 JPG，没有使用媒体 CDN 图片处理。
- 视频创作语音试听返回 Base64，并由浏览器通过音频 Data URL 播放。
- 管理员 Provider 审计素材通过 API 本地文件响应或签名 TOS 地址预览。
- 附件选择器创建 Object URL 读取本地视频时长。
- 单一 `style/preview` 最大长边 1280，密集卡片没有更小的缩略图档位。

## 统一媒体边界

### 持久媒体

用户素材、任务产物、内置人像和内置场景都以生产素材 Bucket `xbeacon-shanghai` 中的对象为准，
浏览器只接收 `files.xbeaconai.com` URL。

内置对象使用稳定 Key：

- `system/portraits/{portraitId}.png`
- `system/scenes/{sceneId}.jpg`

同步脚本读取现有目录中的上游地址或本地文件，检查对象是否存在并幂等上传缺失对象。
部署前检查必须确认清单中的全部对象都存在，禁止缺失时回退到 API 或第三方源地址。

### 临时媒体

语音试听写入 `ephemeral/voice-previews/{userId}/{contentHash}.mp3`。相同用户、音色参数和文本使用稳定哈希复用，
Bucket 生命周期负责清理临时前缀。API 返回 CDN URL，不再返回 Base64。

本地待上传文件在完成 TOS 直传和素材登记前不产生浏览器媒体地址。视频时长使用已有前端媒体解析能力直接读取
`File`，不创建 Object URL。

### 管理员审计素材

管理员查看 Provider 审计素材时，复用任务产物公共媒体持久化逻辑。素材必须先落入生产素材 Bucket，再返回
CDN URL。只有文本、日志和敏感配置继续使用鉴权附件响应。

## 图片 URL 分级

- 缩略图：密集列表、选择器和小卡片使用 `thumbnail` 图片处理样式，长边不超过 320px、WebP、质量约 75。
- 普通预览：详情面板和中等预览使用现有 `preview` 样式，长边不超过 1280px、WebP、质量约 80。
- 原图：全屏查看、下载和需要原始像素的操作使用不带图片处理参数的 CDN URL。

API 媒体对象统一返回 `thumbnailUrl`、`url` 和 `originalUrl`。视频与音频三个字段均指向同一个原文件 CDN URL；
它们不附加图片处理参数，并必须支持 Range 请求。

## 组件和契约

- 公共媒体 URL 工具统一构造缩略图、预览图和原图 URL，禁止页面手工拼接图片处理参数。
- `MediaPreview` 使用预览 URL，图片全屏使用原图 URL；密集卡片显式使用缩略图 URL。
- 内置人像和场景目录同时提供 CDN 缩略图、预览图及原图，不把上游源地址作为浏览器字段。
- 语音试听契约由 `{ audioBase64, mimeType }` 改为 `{ url, mimeType }`，并重新生成 OpenAPI 与 Web SDK。
- Web 不直接消费媒体 `/api/.../content` 路径。仍用于非浏览器内部流程的路由不得被原生媒体元素引用。
- 静态 UI 资源如 Logo 继续由 `app.xbeaconai.com` Web CDN 提供，不复制到业务媒体 Bucket。

## 错误处理

- CDN、TOS 或系统媒体清单未就绪时，生产启动或发布失败，不回退到 API 代理、签名 URL、Blob 或 Data URL。
- 系统媒体同步逐项报告失败对象，已存在对象不重复上传。
- 语音试听上传失败时返回结构化可重试错误，不把 Provider 返回的 Base64 作为兜底。
- 图片处理响应格式或尺寸不符合约定时，生产检查失败。
- 管理员审计中的非媒体文件保持附件下载；无法持久化的媒体明确显示不可预览。

## 验证

- 单元测试覆盖三档公共媒体 URL、MIME 分流、编码和无公共域名时的开发行为。
- 集成测试覆盖人像、场景、语音试听和管理员审计素材只返回 CDN URL。
- 静态回归测试扫描 Web 生产源码，禁止 Blob URL、媒体 Data URL、第三方媒体展示 URL和原生媒体元素使用
  `/api/.../content`。
- 云端检查验证 `thumbnail` 为 WebP 且长边不超过 320、`preview` 为 WebP 且长边不超过 1280、
  视频 Range 返回 206、缓存键包含图片处理参数。
- 按 API 契约流程重新生成 OpenAPI 和 SDK，并运行相关测试、`make ci`、`bun run typecheck` 和
  `bun run build`；默认不运行 E2E。
