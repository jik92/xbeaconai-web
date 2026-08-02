# 通知中心样式修复设计

## 问题

通知条目已迁移到共享 `Button`，但仍依赖旧的 `.notification-list` 和 `.panel-toolbar` CSS。共享 compact
按钮的固定高度、单行文本和居中布局与通知条目的多行内容冲突，造成内容溢出和列表重叠。

## 方案

- 删除通知中心专用 CSS，使用 Tailwind 完成工具栏、列表、分隔线、图标和文本布局。
- 通知条目继续使用 shadcn `Button`，采用 `ghost` 与 compact 默认尺寸，并用 `h-auto`、`whitespace-normal`、
  `items-start` 和 `justify-start` 支持多行内容。
- 未读与已读共用相同结构；已读项仅降低文字和图标强调，不对整行设置透明度。
- 保留当前加载、空状态、单条已读和全部已读的数据行为。

## 验证

- 添加静态回归测试，约束通知中心使用 ghost Button、多行自适应布局，且旧 CSS 已删除。
- 运行相关单元测试、TypeScript 类型检查和生产构建。
