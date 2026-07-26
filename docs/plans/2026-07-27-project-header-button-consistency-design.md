# 项目 Header 按钮视觉统一设计

## 目标

- 以“一键成片”Header 的 compact shadcn Button 组合为产品页面基准。
- 消除“爆款二创”Header 的页面级按钮阴影、额外间距和错误 variant。
- 迁移仍使用旧私有 Header 按钮样式的视频剪辑页面。
- 显式标注千川页面 Header 的 compact 尺寸，避免依赖共享默认值产生漂移。
- 所有 Modal、Drawer 和预览 Header 的关闭操作统一为 `ghost + icon-sm`。

## 语义基准

- 主操作：`variant="default" size="sm"`。
- 次操作、保存、记录和刷新：`variant="outline" size="sm"`。
- 新建、重置和低强调辅助操作：`variant="ghost" size="sm"`。
- Header 关闭操作：`variant="ghost" size="icon-sm"`，并保留明确的 `aria-label`。
- 同一操作组使用 8px 间距，不添加页面私有阴影、字号、高度或圆角。

## 修改范围

### 页面 Header

- 一键成片：作为视觉和语义基准，不重构页面结构。
- 爆款二创：“生成记录”使用 outline，“新建”使用 ghost；操作组使用 8px 间距，删除按钮专属视觉覆盖。
- 视频剪辑：“添加”使用 outline，“导出”使用 default，均使用 sm；删除 `primary-action` 和 34px 私有 Header 按钮规则。
- 千川商户绑定、千川 PC 投放：为 Header 操作补充显式 `size="sm"`。

### Header 关闭操作

统一附件选择、文件预览、通用任务详情、账号抽屉、AI 创作确认/结果、爆款二创三个选择器和视频剪辑导出弹窗中的关闭按钮。

## CSS 边界

- 页面 CSS可以定义 Header 的高度、网格和操作组布局。
- Button 的高度、内边距、边框、圆角、颜色、字号、hover、focus 和 disabled 状态由共享组件及其 variant/size 负责。
- 若旧页面存在覆盖共享 Button 的宽泛选择器，只移除或收窄目标 Header 范围，不改变无关业务控件。

## 防回归与验证

- 增加源码测试，校验一键成片与爆款二创的“生成记录 / 新建”具有同一 variant、size 和间距语义。
- 校验视频剪辑 Header 不再使用 `primary-action` 或私有尺寸。
- 扫描所有 `aria-label` 以“关闭”开头的共享 Button，要求使用 `ghost + icon-sm`。
- 运行相关单元测试、完整单元测试、类型检查和生产构建；按仓库要求不运行 E2E。

