# AI 与 FFmpeg 能力验收报告

更新时间：2026-07-18（Asia/Shanghai）

## 实际验证通过

| 类型 | Provider / 实现 | 模型或能力 | 实测结果 |
|---|---|---|---|
| 文本生成 | Aihubmix | `gpt-4.1-nano-free` | 返回非空中文文本，2.114 秒 |
| 图片生成 | Aihubmix | `gpt-image-1-mini` | PNG 1024×1024，1,075,563 bytes |
| 音频生成 | Aihubmix | `tts-1` | WAV / PCM S16LE，2.275 秒 |
| 视频生成 | Aihubmix | `doubao-seedance-2-0-260128` | 1280×720，5.062 秒，H.264/AAC，创建→轮询→下载完整链路，269.9 秒 |
| 视频生成 | Aihubmix | `doubao-seedance-2-0-mini-260615` | 1280×720，5.088 秒，H.264/AAC，创建→轮询→下载完整链路，165.0 秒 |
| 视频生成 | Aihubmix | `doubao-seedance-2-0-fast-260128` | 1280×720，5.088 秒，H.264/AAC，创建→轮询→下载完整链路，246.8 秒 |
| 媒体处理 | FFmpeg 8.1.1 | 9 个注册适配器 | 9/9 通过 |

FFmpeg 已实际覆盖：样片生成、探测、转码、抽帧、抽音频、切分、合成、字幕叠加、降噪。每个注册能力都有独立测试适配器与结果证据。

AIHubMix 实时目录在 2026-07-18 16:27（Asia/Shanghai）确认三款 Seedance 精确模型 ID均存在且类型为 video。三款基线请求都实际接受 `extra_body.resolution=720p`、`ratio=16:9`、`duration=5`、`generate_audio=true`，成片参数与请求相符。Wan 已从新任务注册表、白名单和前端选择中移除。

## TOS 与多模态参考链路

`xbeacon` 已按真实地域 `cn-beijing` 接入。TOS 实测完成上传、Head、签名读取、删除、分片中断回收与残留分片扫描；对象启用 AES256 服务端加密。签名读取返回 200，匿名读取返回 403，Bucket 已验证为私有。`seedance-staging/` 已配置 `cleanup-ready=true` 的 1 天过期规则，以及 1 天后终止未完成分片的规则。

| Seedance 模型 | 图片参考 | 视频 + 音频联合参考 | 音频关闭参数 |
|---|---|---|---|
| `doubao-seedance-2-0-260128` | 成片成功 | 成片成功 | 上游忽略，仍生成 AAC |
| `doubao-seedance-2-0-mini-260615` | 成片成功 | 成片成功 | 上游忽略，仍生成 AAC |
| `doubao-seedance-2-0-fast-260128` | 成片成功 | 成片成功 | 上游忽略，仍生成 AAC |

六条场景均通过真实的“本地上传 → 所有权校验 → TOS 私有暂存 → 签名 URL → AIHubMix → 轮询 → 下载 → FFprobe → TOS 清理”产品链路。三条联合参考场景完整符合预期；三条图片参考场景均成功出片，唯一能力偏差是 `generate_audio=false` 未被上游执行。因此产品不提供关闭音频开关，生产请求固定使用已验证的音频生成路径。

当前 AccessKey 能完成 Bucket 枚举、策略和生命周期操作，权限范围大于运行时所需。功能验收不受影响；生产部署应换成仅允许 `xbeacon/seedance-staging/*` 上传、读取、删除与分片管理的最小权限凭证。

## 当前使用 Mock 的上游能力

以下能力没有可用的独立上游接口或尚未完成真实接口映射，因此当前保持可操作的确定性 Mock，不会伪装成真实结果：

- 视频理解、镜头级语义分析、素材自动匹配
- 真正的音色训练/声音克隆（TTS 试听已可真实调用）
- 视频生成式修复、缺帧补全、字幕擦除与背景 inpaint
- AI 超分、人脸增强、智能补帧
- 批量混剪策略、平台查重、裂变矩阵调度
- 数字人驱动与口型同步

任务响应的 `executionPlan`、`provenance`、`overallExecutionMode` 和每个 artifact 的 `lineage` 会区分 `real`、`local`、`mock`、`mixed`。真实接口失败且允许降级时，`fallbackReason` 会保留失败原因。

## 验收命令

```bash
bun run test:models --reuse-verified
bun run test:tos
bun run test:seedance:multimodal
bun run test:ffmpeg
bun run api:spec
bun run api:generate
bun run typecheck
bun test tests/unit
bun run build
bun run e2e
```

能力注册表必须满足 `registered === attempted === reported`；否则测试直接失败。模型与 FFmpeg 报告同时作为运行时门禁，没有通过报告的能力不会进入真实/本地执行计划。
