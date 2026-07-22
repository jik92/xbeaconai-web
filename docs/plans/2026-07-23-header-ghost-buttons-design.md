# Header Ghost 按钮设计

## 目标

Header 中的辅助操作统一使用现有 shadcn `Button` 的 `ghost` 主题，保持紧凑、轻量和一致的交互反馈。

## 实现

- 帮助、通知使用 `variant="ghost"`、`size="icon"`，尺寸收紧到 Header 现有的 34px。
- 账号入口使用 `variant="ghost"`、`size="sm"`，保留用户名截断和手机号回退。
- 搜索快捷键使用 `variant="ghost"`、`size="sm"`，保留快捷键标签和聚焦搜索行为。
- 充值属于强调操作，保留当前独立主题。
- 移除以上按钮依赖的重复背景、圆角和 hover CSS，由共享 Button 组件负责主题语义。

## 验证

- 检查 Header 辅助按钮均复用共享 `Button`。
- 运行相关单测、格式检查、类型检查和构建，不运行 E2E。
