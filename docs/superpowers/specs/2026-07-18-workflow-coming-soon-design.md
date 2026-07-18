# 创作工作流 Coming Soon 开放控制设计

## 目标

在一个集中常量中控制“创作工作流”子菜单是否开放。初始将三个工作流功能全部设为 `coming-soon`；产品验收通过后，只修改对应常量为 `open` 即可单项开放。“AI 工具箱”和资产菜单不受影响。

## 状态常量

新增唯一共享状态表。前端菜单、前端路由和 Hono 创建任务接口必须导入同一个只读 registry，不得复制配置：

```ts
export const WORKFLOW_FEATURE_STATUS = {
  "video-remix": "coming-soon",
  "video-create": "coming-soon",
  "ad-script": "coming-soon",
} as const;
```

状态只允许：

- `coming-soon`：菜单可见，显示 `Coming Soon`，不可进入正式功能。
- `open`：菜单正常可点击，路由展示正式功能。

该状态表是唯一开放来源，不在菜单组件、路由组件或功能页面中重复维护布尔值。

同时提供接受可选 registry 参数的纯判定函数，例如 `isWorkflowOpen(moduleId, registry)`。生产调用不传参数，只读生产常量；测试可注入 fixture，不能在运行时修改生产常量。

## 菜单与路由行为

- `coming-soon` 菜单保留图标和名称，增加 `Coming Soon` 标签并使用禁用视觉。
- 点击禁用菜单不导航，避免用户误以为功能已经开放。
- 所有指向三个工作流 module ID 的路由在正式页面组件挂载前经过同一 route guard；直接深链、预加载和浏览器前进后退均展示统一 Coming Soon 占位页，不先挂载正式页面或发起页面请求。
- `open` 状态保持现有菜单和页面行为。
- 当前没有工作流路由别名；未来新增别名时必须复用同一个 module ID guard。
- 根路径在三个工作流均关闭时明确跳转到既有 AI 工具箱路由 `/tools/ai-generate`，不为 AI 工具箱建立第二套开放状态。

## API 行为

- `POST /api/{moduleId}/jobs` 在持久化任务、扣除创作点或调用 Provider 之前，通过同一个共享判定函数检查三个工作流 module ID。
- `coming-soon` 返回稳定错误码 `FEATURE_NOT_OPEN`，不创建任务、不扣点、不进入队列。
- `open` 保持现有 API 行为。
- 读取能力目录、历史任务等只读接口不受影响。

## 测试

- 单元测试断言状态表只包含三个创作工作流模块，且状态值合法。
- E2E 断言三个菜单显示 `Coming Soon` 且不可导航。
- E2E 断言直接访问三个路径均展示占位页。
- API 测试断言三个模块均返回 `FEATURE_NOT_OPEN`，且没有任务持久化或扣点。
- E2E 断言 AI 工具箱菜单仍可点击、`/tools/ai-generate` 正常展示、根路径回退到该地址。
- 使用注入 fixture `{ "video-remix": "open" }` 的共享 guard 测试一次覆盖菜单判定、route guard 和 API guard：该项三层均开放，另外两项仍关闭。生产常量不在运行时修改。
