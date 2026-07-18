# 统一项目配置设计

## 目标

将项目名称、创作工作流、AI 工具箱和资产菜单的开放状态集中到一个共享的 `src/app/config.ts` 文件。产品验收人员只修改这一处 Boolean 常量，即可同步控制前端菜单、直接路由和任务提交接口。

## 配置结构

```ts
export const APP_CONFIG = {
  projectName: "曜作",
  menuFeatures: {
    creationWorkflow: {
      "video-remix": false,
      "video-create": false,
      "ad-script": false,
    },
    aiToolbox: {
      "ai-generate": true,
      "video-cut": true,
      "media-understand": true,
      "video-mashup": true,
      "voice-clone": true,
      "video-renewal": true,
      "subtitle-erase": true,
      "video-enhancement": true,
      "kickart": true,
    },
    assets: {
      portraits: true,
    },
  },
} as const;
```

`true` 表示开放，`false` 表示等待验收。运行时密钥、端口和数据库位置仍由服务端环境配置管理，不进入前端可读取的共享配置。

## 功能状态

`config.ts` 导出类型安全的功能 ID、状态读取函数和首页路径选择函数。旧的 `workflow-feature-status.ts` 被移除，所有消费者直接引用统一配置。

- 开放的模块在侧栏中显示为正常链接。
- 关闭的模块显示不可点击的 `Coming Soon` 项。
- 关闭模块的直接 URL 显示统一占位页，真实功能组件不会挂载。
- 关闭任务型模块的 API 返回 `403 FEATURE_NOT_OPEN`，检查发生在持久化、扣积分、入队和模型调用之前。
- 关闭人像库后，`/assets/portraits` 也显示统一占位页。
- 首页跳转到模块列表中的第一个开放功能；模块全部关闭但人像库开放时跳转人像库；全部关闭时显示项目级 `Coming Soon` 页面。

## 项目名称

`APP_CONFIG.projectName` 的默认值为“曜作”，并替换运行代码里的品牌硬编码，包括：

- 顶栏、登录页、加载状态和侧栏版本文案；
- 欢迎通知与默认生成文案；
- 服务端和 E2E 服务启动日志；
- OpenAPI 标题；
- AI 文本助手系统提示词。

历史设计文档中的品牌名称属于历史记录，不做替换。

## 测试与验收

- 单元测试断言配置完整覆盖全部 12 个模块和人像库。
- 使用可注入配置夹具验证 Boolean 开关和首页回退顺序。
- Hono 测试验证关闭的任务型模块不创建任务、不扣积分。
- Playwright 验证菜单状态、直链占位、人像库关闭行为以及开放功能的现有流程。
- 运行 OpenAPI/SDK 生成、TypeScript 检查、单元测试、E2E 和生产构建。
- 所有测试使用 Mock 或本地能力，不触发 Seedance 或其他付费模型调用。
