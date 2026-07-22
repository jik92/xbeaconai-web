# 分镜 Shadcn Switch 修复设计

## 目标

删除分镜页面自定义 Switch 实现，统一使用 shadcn 官方 Radix Switch，修复点击区域、状态切换和视觉表现问题。

## 实现

- 新增 shadcn 标准 `Switch` 基础组件，并安装 `@radix-ui/react-switch`。
- 表头配音/字幕批量开关与分镜行内开关全部使用同一组件。
- 使用受控的 `checked`、`onCheckedChange` 和 `disabled` 属性；任务提交期间禁用重复操作。
- 不新增页面 CSS，组件仅使用 shadcn 官方 Tailwind 类和现有设计 Token。

## 验证

- 增加静态组件测试，确保分镜页不再包含自定义 Switch。
- 运行相关单测、类型检查和生产构建；页面交互由用户手动验证。
