# 音色克隆 Job

## 定位

`worker/jobs/job-voice-clone.ts` 处理 `moduleId === "voice-clone"`，涵盖预置音色合成和经授权的克隆音色流程。

## 维护边界

- 写接口先使用 `server/voice/validate-voice-task.ts` 校验授权、有效期、合成范围与语速；Worker 不得绕过这些安全规则。
- Provider 适配在 `server/providers/volc-speech.ts`，预置音色/风格在 `shared/voice/`；对应 Definition 为 `definitions/voice-clone.ts`。
- 凭据和供应商错误不得写入结果、日志或前端错误消息。

修改时阅读 [音色克隆专题](../../voice-clone-development.md)，并回归授权、过期授权、预置音色、轮询、NDJSON 音频和错误可重试性测试。

