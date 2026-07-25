# 抖音美好体字幕字体整合设计

## 目标

将 ByteDance 官方开源的抖音美好体随项目发布，并让一键成片的 FFmpeg 字幕合成稳定使用该字体，避免依赖开发机或生产服务器预装字体。

## 字体来源与授权

- 上游仓库：`https://github.com/bytedance/fonts`
- 固定上游提交：`327565b61501d7a6d4902ed6ce417a7bd2ae54e6`
- 字体文件：`DouyinSans/DouyinSansBold.ttf`
- 字体 SHA-256：`fbecfacdfac33982774e301073a8d357a09c698cd3134bb6ddec0f5bfc268fa1`
- 授权：SIL Open Font License 1.1

仓库同时保存原始字体和 `OFL.txt`，不修改字体文件及其保留字体名称。

## 运行时设计

字体存放在 `assets/fonts/douyin-sans/`。`burnSubtitleFile` 使用基于 `import.meta.dir` 的绝对路径设置 libass `fontsdir`，并将字幕样式的 `FontName` 固定为 `DouyinSans`。

合成前检查字体文件存在。字体缺失时直接返回结构化错误，不允许静默回退到系统字体，从而保证本地、测试和生产输出一致。

## 范围

`burnSubtitleFile` 当前仅由一键成片的自动字幕、手动字幕合成和最终合成流程使用，因此修改会统一覆盖这三条路径，不影响其他视频模块。

## 验证

- 校验仓库字体 SHA-256 与官方文件一致。
- 现有 FFmpeg Mock 一键成片测试实际执行字幕烧录，验证字体文件可被生产路径使用。
- 检查 FFmpeg、类型检查、生产构建和完整单元测试。
- 按仓库要求不运行 E2E。
