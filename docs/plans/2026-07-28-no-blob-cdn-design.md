# 全站移除 Blob URL 并统一媒体 CDN 设计

## 目标

Web 生产代码不再创建、持有或消费 `blob:` URL。所有已经持久化的图片、音频和视频都直接使用
`https://files.xbeaconai.com` CDN 地址；本地文件必须先上传私有 TOS，再通过 API 返回的 CDN 地址预览。

文本、Markdown、日志和敏感配置导出不进入 CDN，也不在浏览器中创建 Blob URL，而是通过带
`Content-Disposition: attachment` 的服务端响应直接下载。

## 方案选择

采用“媒体走 CDN、非媒体走附件响应”的方案。

- 不把 `.env.key` 等敏感内容上传 TOS/CDN，避免长期对象和缓存造成密钥泄露。
- 不使用 Data URL 代替 Blob URL，因为它仍然绕过 CDN，并显著增加浏览器内存占用。
- 不保留受保护媒体接口到 Blob URL 的兼容回退；API 必须返回可直接加载的 CDN URL。

## 数据流

### 已持久化媒体

1. Server 根据用户资源所有权读取素材或任务产物。
2. Server 将 TOS object key 映射为编码后的 CDN 原始地址。
3. 图片预览追加 `?x-tos-process=style/preview`，视频和音频使用原始 CDN 地址。
4. Web 将 CDN 地址直接传给原生 `img`、`video` 或 `audio`。
5. 全屏原图、下载和视频编辑器预览继续使用 CDN 地址，不再发起鉴权媒体请求并转换 Blob。

### 本地待上传媒体

1. 选择文件后立即进入上传状态；上传完成前只显示文件名、大小和进度。
2. 浏览器通过现有直传授权将文件上传私有 TOS。
3. 完成接口校验对象并注册素材，返回 CDN URL。
4. 页面收到素材后再显示 CDN 预览。
5. 视频编辑器通过上传后 CDN 地址读取 metadata，再加入时间线。

### 文本和敏感文件下载

1. Server 返回附件响应并设置正确的 `Content-Type` 和 `Content-Disposition`。
2. Web 使用普通链接、表单或页面导航触发下载。
3. `.env.key` 等敏感内容只通过鉴权 API 传输，禁止写入 TOS/CDN。
4. 没有持久化 artifact URL 的纯文本任务结果改用附件导出接口，不在浏览器拼装文件。

## 组件与契约

- 删除 `authenticatedBlobUrl`，将现有调用方改成 CDN URL 或附件下载。
- `MediaPreview` 和 `AuthenticatedMedia` 只接收可直接加载的 URL，不再维护 Blob 生命周期。
- `FileUpload` 删除本地 Object URL 预览；上传完成后使用 `uploadedFiles[].url`。
- 视频编辑器上传完成后使用素材 API 返回的 CDN URL读取 metadata 和播放。
- 素材、商品图片和任务 artifact API 必须同时遵守 owner 隔离并返回 CDN URL。
- 文本导出 API 使用结构化错误格式并设置安全附件响应头。
- CSP 从 `img-src` 和 `media-src` 删除 `blob:`。

## 错误处理

- TOS/CDN 未配置时，媒体上传或读取明确失败，不回退到本地 Blob 或 Mock。
- 上传失败时保留文件名、进度和重试操作，但不尝试本地媒体预览。
- API 返回非 CDN 媒体地址时，组件显示加载失败；测试阻止重新引入 Blob 回退。
- 附件下载失败时沿用现有错误提示，不在客户端生成替代文件。

## 测试与验收

- 先增加失败测试，证明当前代码仍会创建 Blob URL。
- 为上传组件、媒体预览、视频编辑器、下载接口和安全响应头补充针对性测试。
- 增加静态回归测试，扫描 `web/` 生产源码，禁止：
  - `URL.createObjectURL`
  - `URL.revokeObjectURL`
  - 字面量 `blob:`
- CSP 测试确认媒体指令不再允许 `blob:`，只允许自身来源、必要的 `data:` 图片和精确 CDN 来源。
- API 集成测试确认用户隔离不变，媒体 URL 来自 `https://files.xbeaconai.com`。
- 运行相关单测、`bun run typecheck` 和 `bun run build`；默认不运行 E2E。
