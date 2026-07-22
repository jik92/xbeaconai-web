# Tailwind 全站字体系统设计

## 目标

全站文字样式统一由 Tailwind v4 字体 Token 管理。移除业务 CSS 中直接书写的字体族、字号、字重、行高和字距，收敛当前大量离散的小数值，并保持产品工作台紧凑、清晰的视觉密度。

## 字体族

- `font-sans`：`Inter`、`PingFang SC`、`Microsoft YaHei`、`ui-sans-serif`、`system-ui`、`sans-serif`。
- `font-display`：当前与 `font-sans` 相同，作为未来接入授权展示字体的稳定入口。
- `font-mono`：使用 Tailwind 默认等宽字体栈。
- 仓库未包含 Waldenburg 或 Inter 字体文件，不新增外部字体网络依赖。

## 紧凑字号阶梯

| Tailwind Token | 字号 / 行高 | 用途 |
| --- | --- | --- |
| `text-2xs` | 10px / 14px | 极小元数据、紧凑状态 |
| `text-xs` | 12px / 16px | 辅助文字、标签、说明 |
| `text-sm` | 14px / 20px | 默认产品正文、表单、按钮、表格 |
| `text-base` | 16px / 24px | 强调正文、较宽松内容 |
| `text-lg` | 18px / 26px | 小标题 |
| `text-xl` | 20px / 28px | 组件和弹窗标题 |
| `text-2xl` | 24px / 32px | 页面标题 |
| `text-3xl` | 30px / 36px | 大页面标题 |
| `text-4xl` | 36px / 42px | 展示标题 |
| `text-5xl` | 48px / 52px | 营销展示标题 |
| `text-6xl` | 64px / 68px | 首页主视觉标题，产品工作台禁用 |

产品工作台默认使用 `text-sm`，常规标题不超过 `text-3xl`。迁移时将 7–11px 收敛至 10px、12–13px 收敛至 12px，并把其他离散字号映射到最接近且不放大的标准阶梯。

## 字重、行高和字距

- 字重只允许 `font-light`、`font-normal`、`font-medium`、`font-semibold`。
- `font-light` 仅用于展示标题；正文使用 `font-normal`，交互和强调使用 `font-medium` 或 `font-semibold`。
- 行高使用 Tailwind 字号自带行高；确需覆盖时只使用 `leading-none`、`leading-tight`、`leading-snug`、`leading-normal`、`leading-relaxed`、`leading-loose`。
- 字距只使用 `tracking-tight`、`tracking-normal`、`tracking-wide`、`tracking-wider`、`tracking-widest`。

## 实现与迁移

- 在 `web/styles/globals.css` 的 `@theme inline` 中维护字体族和字号 Token，作为唯一数据源。
- TSX 直接使用 Tailwind 字体 utility。
- 仍由 CSS 选择器维护布局的旧页面，通过 `@apply text-* font-* leading-* tracking-*` 使用同一套 Token。
- 完整迁移 `web/**/*.css` 中的裸 `font-family`、`font-size`、`font-weight`、`line-height` 和 `letter-spacing`。
- 表单控件的 `font: inherit` 作为基础继承机制保留；Tailwind `@theme` 内的 Token 定义不计为违规。
- 增加静态检查脚本并接入常规检查，阻止业务 CSS 再次引入裸字体属性或任意字体值。

## 文档与验证

- 重写 `DESIGN.md` 的 Typography 章节、组件文字映射、Do/Don't 和迭代约束。
- 运行字体规则扫描、Biome、单元测试、TypeScript 类型检查和生产构建。
- 按用户要求不运行 E2E；视觉风险通过标准化 Token、构建和受影响文件审查控制。
