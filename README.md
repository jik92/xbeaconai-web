# 曜作 AI 创作工作台

基于 clean-room 方法设计的 AI 视频创作前端原型，使用 Bun、React Hooks、TypeScript、Tailwind CSS、shadcn/ui 与 TanStack 工具链构建。

## 功能

- 创作工作流：爆款二创、一键成片、口播脚本
- AI 工具箱：AI 创作、视频分割、素材理解、视频混剪、音色克隆、视频修复、字幕擦除、画质增强、爆款裂变
- 资产：包含 1,125 份档案的虚拟人像库
- IndexedDB 草稿与任务持久化
- Mock 异步任务、失败重试、取消和部分成功状态
- 桌面端与平板端响应式布局

## 本地开发

```bash
bun install
bun run dev
```

默认访问地址为 `http://127.0.0.1:5173`。

## 验证

```bash
bun test
bun run typecheck
bun run build
bun run e2e
```

## 部署

项目可以作为静态单页面应用部署到 Cloudflare Pages：

```bash
bun run build
bunx wrangler pages deploy dist
```

当前演示地址：[yaozuo-ai-studio.pages.dev](https://yaozuo-ai-studio.pages.dev)
