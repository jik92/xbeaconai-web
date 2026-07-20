# 火山引擎音色克隆脚本开发文档

> 文档状态：开发设计稿  
> 更新时间：2026-07-21  
> 适用范围：火山引擎豆包语音“声音复刻 / 声音复刻 2.0”与复刻音色 TTS  
> 目标语言：TypeScript 6 + Bun 1.3+

## 1. 目标与范围

本文用于指导开发一套可在本地、CI 或服务端运行的音色克隆脚本，完成以下闭环：

1. 校验训练录音与授权材料；
2. 将录音上传到火山引擎并发起声音复刻；
3. 轮询复刻状态并保存 `speaker_id`、版本和试听地址；
4. 使用复刻音色进行短文本 TTS 合成；
5. 支持方言文案、配音风格模板、批量任务、重试、日志和监控；
6. 对训练、试听、启用和正式合成实施明确的授权与审计。

本文不包含：Web 管理界面、实时语音通话、唇形驱动、完整音频编辑器、自动购买音色槽位，以及未经授权的公众人物或第三方声音复刻。

### 1.1 关键约束

- `speaker_id` 是音色槽位/复刻音色的唯一标识，应从豆包语音控制台或音色查询接口取得，不应由脚本自行伪造。
- 新版控制台可能使用 API Key，旧版应用常见 AppID + Access Token；音色管理/购买类 OpenAPI 还可能使用 AK/SK 签名。三类凭据不要混用。
- 训练上传与 TTS 的 `Resource-Id`、模型类型必须和账号实际开通的能力、`speaker_id` 所属模型一致。
- 预付费和后付费音色的训练、首次合成、固定规则不同。正式合成可能触发计费或使音色不可再次训练，必须在调用前核对控制台当前规则。
- “复刻音色”“方言发音”“表演风格”是三个不同维度；不能把克隆某人的声纹等同于模型稳定支持该方言。

## 2. 官方资料与版本基线

接入前应重新核对以下官方页面，本文中的 URL、模型值和配额不得替代控制台的实时配置：

- [声音复刻下单及使用指南](https://www.volcengine.com/docs/6561/1167802?lang=zh)
- [声音复刻录音指导](https://www.volcengine.com/docs/6561/1204182?lang=zh)
- [声音复刻 2.0 最佳实践](https://www.volcengine.com/docs/6561/2298705?lang=zh)
- [音色管理 API](https://www.volcengine.com/docs/6561/2235883?lang=zh)
- [大模型语音合成 API](https://www.volcengine.com/docs/6561/2228192?lang=zh)
- [语音合成方案对比](https://www.volcengine.com/docs/6561/1257543?lang=zh)

官方能力和控制台在持续演进。脚本应把域名、路径、鉴权模式、资源 ID、模型类型放进配置，不要散落在业务代码中。

## 3. 整体架构

```text
命令行 / 调度器
       │
       ├── consent：登记授权与使用范围
       ├── validate：ffprobe/ffmpeg 校验并规范训练音频
       ├── clone：上传训练音频
       ├── status：查询或轮询训练状态
       └── synthesize：按方言与风格模板合成
                    │
                    ▼
             VoiceCloneService
       ┌────────────┼─────────────┐
       ▼            ▼             ▼
 TrainingClient  TtsClient   MetadataStore
       │            │             │
       └──── 火山引擎 API ────┐   └── SQLite/JSONL
                              ▼
                         音频对象存储
```

建议把“上传/训练”与“合成”拆成独立客户端，原因是两者可能采用不同接口版本、资源 ID 和鉴权头。业务层只接收统一 DTO，不直接依赖供应商响应字段。

### 3.1 推荐状态机

```text
DRAFT → CONSENTED → AUDIO_VALIDATED → TRAINING → READY
  │          │               │             │       │
  └──────────┴───────────────┴──→ FAILED   └──→ ACTIVE
                                              （可能不可再训练）
```

本地状态只是缓存；最终状态以火山引擎查询结果为准。已知旧版查询接口常见状态为：`0 NotFound`、`1 Training`、`2 Success`、`3 Failed`、`4 Active`。接入新版接口时，应在适配层映射为上述内部枚举。

## 4. 前置准备

### 4.1 账号与服务

1. 在火山引擎控制台创建项目和豆包语音应用；
2. 开通“声音复刻 2.0”及需要的音色服务/TTS 服务；
3. 根据计费方式购买或创建音色槽位；
4. 获取 `speaker_id`、AppID 和当前接口所需凭据；
5. 在控制台确认 `speaker_id` 对应的模型、资源 ID、可用状态和配额；
6. 在测试账号先完成小额、短文本全链路验证。

音色槽位是计费资源。不要在普通重试逻辑中自动下单、续费或激活音色；这些操作应进入单独的人工审批流程。

### 4.2 本地环境

```bash
bun install
bun --version
ffmpeg -version
ffprobe -version
```

本项目直接使用 Bun 内置的 `fetch`、`Bun.file`、`Bun.write` 和 `Bun.CryptoHasher`，无需为基础 HTTP、文件和哈希能力增加第三方依赖。生产环境不要依赖系统临时安装的 FFmpeg。

### 4.3 训练录音

声音复刻 2.0 的官方最佳实践优先选择 14～30 秒 WAV；另一份官方录音指导对一般 ICL 场景建议 10～15 秒。实际开发建议以 14～15 秒作为首个基线样本，并按控制台目标模型的最新要求验收：

- 单人、单声道，优先 24 kHz WAV；
- 低底噪、无混响、无背景音乐、无人声重叠；
- 开头和结尾完整，无削波、爆音、吞音、咂嘴等瑕疵；
- 语速与情绪稳定，并保留说话人的自然特征；
- 方言音色应使用目标方言录音，同时保留准确逐字稿；
- 中英混合应用的参考音频最好同时覆盖中英文；
- 原始文件、处理后文件、哈希、授权记录和逐字稿应关联保存。

可用以下命令生成工程基线文件：

```bash
ffmpeg -i input.wav -ac 1 -ar 24000 -c:a pcm_s16le training-24k-mono.wav
ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,sample_rate,channels \
  -of json training-24k-mono.wav
```

降噪可能损失音色细节。只有底噪明显时才开启，并将原始/降噪版本分别试听对照。

## 5. 鉴权与配置

### 5.1 凭据分层

| 场景 | 常见凭据 | 用途 |
| --- | --- | --- |
| 复刻上传、状态查询、TTS | AppID + Access Token，或新版 API Key | 运行时语音接口 |
| 音色下单、续费、批量管理 | Access Key + Secret Key 签名 | `open.volcengineapi.com` OpenAPI |
| 本应用调用 | 自有服务 Token | 隔离浏览器/用户与供应商密钥 |

禁止把供应商密钥返回给前端或写入日志、音频元数据、Git、命令历史。本文代码只读取环境变量，不读取或输出 `.env` 内容。

### 5.2 鉴权头

旧版声音复刻接口常见形式：

```http
Authorization: Bearer;{access_token}
Resource-Id: {clone_resource_id}
Content-Type: application/json
```

注意 `Bearer;` 的分隔写法不是标准 OAuth Bearer 空格写法，不要自行改成 `Bearer {token}`。若控制台为新版 API Key 接入，应完全按对应官方文档切换请求头，不能同时猜测发送多套密钥。

音色管理 OpenAPI 的固定参数通常为：

```text
Domain  = open.volcengineapi.com
Region  = cn-north-1
Service = speech_saas_prod
Version = 2023-11-07
```

AK/SK 签名建议使用火山引擎官方 SDK，不要自行拼接签名算法。

## 6. 音色训练/复刻流程

### 6.1 标准流程

1. 生成并审批授权记录；
2. 校验音频后计算 SHA-256，避免误传和重复提交；
3. 从控制台或批量查询接口选择可用 `speaker_id`；
4. 调用上传接口，提交 Base64 音频、格式、模型类型和可选逐字稿；
5. 保存供应商请求 ID、`speaker_id`、模型/资源映射和提交时间；
6. 每 2～5 秒查询一次，使用指数退避并设置总超时；
7. 成功后下载临时试听音频到受控存储，不长期保存供应商临时 URL；
8. 人工对比参考音频、固定验收文案、方言文案和多风格文案；
9. 满意后再进入启用或正式合成步骤。

### 6.2 旧版 AppID/Token 接口示例

```text
POST https://openspeech.bytedance.com/api/v1/mega_tts/audio/upload
POST https://openspeech.bytedance.com/api/v1/mega_tts/status
```

典型上传请求体：

```json
{
  "appid": "${VOLC_SPEECH_APP_ID}",
  "speaker_id": "S_xxxxxxxxx",
  "audios": [
    {
      "audio_bytes": "<BASE64_AUDIO>",
      "audio_format": "wav",
      "text": "与录音严格对应的逐字稿"
    }
  ],
  "source": 2,
  "language": 0,
  "model_type": 4,
  "extra_params": "{\"enable_audio_denoise\":false}"
}
```

`model_type=4` 和 `seed-icl-2.0` 是部分声音复刻 2.0 接入配置的常见映射，但账号权限和接口版本可能不同。上线前必须以控制台和当前官方 API 文档为准；若仍在 ICL 1.0/DiT 接口，不得照搬此值。

### 6.3 幂等与不可逆动作

- 本地幂等键建议为 `speaker_id + audio_sha256 + model_type`；
- 网络超时后先查状态，再决定是否重传，避免消耗训练次数；
- “启用/固定音色”不能被自动重试；
- 后付费音色首次正式 TTS 可能触发音色固定和计费，应单独要求 `--confirm-billable-use`；
- 保存每次训练版本，不用新结果覆盖历史验收记录。

## 7. TTS 合成流程

### 7.1 短文本

1. 确认音色状态为可合成；
2. 将方言、场景和风格模板编译成供应商参数/上下文；
3. 为每次请求生成唯一 UUID `reqid`；
4. 单段优先控制在约 300 个汉字或 60 秒以内；
5. 调用非流式接口用于脚本/批任务，调用 HTTP Chunked 或 WebSocket 用于低延迟播放；
6. 校验返回音频格式、时长、文件大小和可解码性；
7. 保存请求 ID、`X-Tt-Logid`、参数快照、音频哈希和计费用量。

旧版 JSON TTS 请求的典型结构如下，字段以实际开通文档为准：

```json
{
  "app": {
    "appid": "${VOLC_SPEECH_APP_ID}",
    "token": "unused-but-non-empty",
    "cluster": "volcano_tts"
  },
  "user": { "uid": "internal-user-id" },
  "audio": {
    "voice_type": "S_xxxxxxxxx",
    "encoding": "mp3",
    "speed_ratio": 1.0,
    "volume_ratio": 1.0,
    "pitch_ratio": 1.0
  },
  "request": {
    "reqid": "UUID_V4",
    "text": "要合成的文本",
    "text_type": "plain",
    "operation": "query"
  }
}
```

声音复刻 2.0 的 `context_texts`、语音指令或情感字段是否可用，取决于所选 TTS 协议和模型。不要把提示词字段强行塞进不支持它的旧版请求；适配器应仅发送该协议声明支持的字段。

### 7.2 长文本

- 优先使用官方异步长文本接口；
- 若采用短文本切片，按标点和语义切分，保留最小上下文，不从 UTF-8 字节中间切断；
- 每段保存索引、原文范围、音频时长和重试次数；
- 拼接前统一采样率、声道、编码与响度；
- 片段间加入可配置停顿，并对边界做试听；
- 供应商下载 URL 通常有时效，应及时转存到自有私有存储。

## 8. 方言与配音风格设计

### 8.1 数据模型

```ts
export interface VoiceRenderSpec {
  speakerId: string;
  language: string; // zh-CN
  dialect: string; // cmn、yue、wuu、nan、hak 等内部编码
  dialectRegion: string; // 如 yue-guangzhou、nan-quanzhou
  style: string; // documentary、news、commerce 等
  emotion: string; // neutral、happy、sad、angry 等
  intensity: number; // 0.0～1.0，业务层抽象值
  speed: number;
  text: string;
  contextTexts: string[];
}
```

业务层字段不应等同于火山引擎字段。Provider Adapter 负责把标准化对象映射到当前协议支持的 `language`、情感、上下文或语音指令；不支持的字段必须返回 capability warning，而不是静默忽略。

### 8.2 方言策略

| 层级 | 示例 | 策略 |
| --- | --- | --- |
| 已验收 | 普通话、某一已实测粤语口音 | 允许生产批量使用 |
| 灰度 | 四川话、东北话等已小样测试方言 | 限场景、抽检发布 |
| 实验 | 温州话、潮汕话、客家话分支等 | 仅试听，不承诺稳定性 |

每个“方言 + 音色 + 风格”组合都要单独验收，至少覆盖：数字、日期、人名地名、多音字、方言特有词、语气词、儿化/变调、代码混读。普通话文字配方言音色不等于地道方言，应由母语者编写或审校口语文案。

### 8.3 风格模板

```yaml
styles:
  documentary:
    instruction: "以沉稳、克制、有画面感的纪录片旁白方式演绎；停顿自然，不要夸张。"
    speed: 0.94
  short_video:
    instruction: "以自然、热情、接地气的短视频解说方式演绎；重点词适度加强。"
    speed: 1.08
  bedtime:
    instruction: "以轻柔、温暖、低能量的哄睡方式演绎；句间停顿稍长。"
    speed: 0.88
```

提示词是软控制，不保证每次完全一致。批量生产应固定模板版本、温度/随机参数（若协议提供）、参考音频和验收集，并做抽样复听。

## 9. API 封装建议

### 9.1 接口边界

```ts
export interface VoiceCloneProvider {
  upload(command: CloneCommand): Promise<CloneSubmission>;
  getStatus(speakerId: string): Promise<CloneStatus>;
  synthesize(command: SynthesisCommand): Promise<AudioResult>;
  capabilities(): ProviderCapabilities;
}
```

建议统一返回：

```json
{
  "provider": "volcengine",
  "request_id": "供应商请求 ID",
  "status": "ready",
  "retryable": false,
  "speaker_id": "S_xxx",
  "model": "voice-clone-2.0",
  "resource_id": "由配置注入",
  "warnings": [],
  "raw_response_redacted": {}
}
```

### 9.2 设计要求

- 将 HTTP 传输、供应商 DTO、业务 DTO、文件存储分离；
- 统一超时、重试、限流、日志脱敏和请求 ID；
- 响应先做 HTTP 校验，再做 JSON/业务状态码校验；
- 仅保存脱敏后的原始响应；
- `speaker_id`、用户、授权记录、样本哈希必须绑定；
- 提供 dry-run，输出将调用的接口和非敏感配置，不上传音频；
- Provider 能力表需区分 `supported`、`verified`、`available`，不能把“文档支持”当成当前账号已可用。

## 10. TypeScript 脚本目录结构

```text
项目根目录/
├── package.json
├── .env.example
├── server/
│   └── providers/
│       └── voice/
│           ├── types.ts
│           ├── volcengine-client.ts
│           └── voice-clone-service.ts
├── worker/
│   └── jobs/
│       └── job-voice-clone.ts
├── shared/
│   └── jobs/
│       └── voice-clone-contract.ts
├── scripts/
│   ├── voice-clone.ts
│   └── test-volcengine-voice-clone.ts
├── tests/
│   ├── fixtures/voice/
│   └── unit/
│       ├── voice-audio.test.ts
│       ├── volcengine-voice-contract.test.ts
│       └── voice-retry.test.ts
├── .data/                 # gitignore，本地输入/输出/元数据
└── artifacts/api-tests/   # gitignore，真实接口测试报告
```

该结构与当前仓库一致：`scripts/` 放人工执行和真实能力检查；API Server 只负责鉴权、持久化和投递任务；长耗时上传、轮询、合成放在 Worker；跨进程消息使用 `shared/jobs/` 中的最小契约。若目前只开发独立脚本，可先实现 `server/providers/voice/` 与 `scripts/voice-clone.ts`，接入产品流程时再注册 Worker Job。

## 11. 核心代码示例

下面是适配当前 Bun/TypeScript 项目的最小异步客户端骨架。真实项目应将模型映射、接口路径和业务状态映射补充为当前账号实测值。

```ts
import { extname } from "node:path";

export class VolcApiError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "VolcApiError";
  }
}

export interface VolcVoiceConfig {
  appId: string;
  accessToken: string;
  speakerId: string;
  baseUrl: string;
  cloneResourceId: string;
  ttsResourceId: string;
  modelType: number;
  requestTimeoutMs: number;
}

type JsonObject = Record<string, unknown>;

const asObject = (value: unknown): JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : {};

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class VolcVoiceCloneClient {
  constructor(private readonly config: VolcVoiceConfig) {}

  private headers(resourceId: string): HeadersInit {
    return {
      Authorization: `Bearer;${this.config.accessToken}`,
      "Resource-Id": resourceId,
      "Content-Type": "application/json",
    };
  }

  private static requestId(response: Response): string | undefined {
    return (
      response.headers.get("X-Tt-Logid") ??
      response.headers.get("X-Top-Request-Id") ??
      response.headers.get("X-Request-Id") ??
      undefined
    );
  }

  private async post(path: string, payload: JsonObject, resourceId: string): Promise<JsonObject> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.config.baseUrl), {
        method: "POST",
        headers: this.headers(resourceId),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
    } catch (error) {
      throw new VolcApiError(error instanceof Error ? error.message : String(error), true);
    }

    const requestId = VolcVoiceCloneClient.requestId(response);
    if (response.status === 429 || response.status >= 500) {
      throw new VolcApiError(`temporary upstream error: HTTP ${response.status}`, true, requestId);
    }
    if (!response.ok) {
      throw new VolcApiError(`upstream rejected request: HTTP ${response.status}`, false, requestId);
    }

    let data: JsonObject;
    try {
      data = asObject(await response.json());
    } catch {
      throw new VolcApiError("upstream returned invalid JSON", true, requestId);
    }

    const baseResp = asObject(data.BaseResp);
    const code = baseResp.StatusCode ?? data.code ?? 0;
    if (code !== 0 && code !== null) {
      const retryableCodes = new Set([1101, 1102, 50000, 50001, 50002]);
      const message = baseResp.StatusMessage ?? data.message ?? `business error ${String(code)}`;
      throw new VolcApiError(String(message), retryableCodes.has(Number(code)), requestId);
    }
    return { ...data, _requestId: requestId };
  }

  async upload(audioPath: string, transcript?: string): Promise<JsonObject> {
    const file = Bun.file(audioPath);
    if (!(await file.exists())) throw new Error(`training audio not found: ${audioPath}`);
    if (file.size > 10 * 1024 * 1024) throw new Error("training audio exceeds configured 10 MiB safety limit");

    const audioFormat = extname(audioPath).toLowerCase().slice(1);
    if (!new Set(["wav", "mp3", "ogg", "m4a", "aac", "pcm"]).has(audioFormat)) {
      throw new Error(`unsupported audio format: ${audioFormat}`);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const audioItem: Record<string, string> = {
      audio_bytes: Buffer.from(bytes).toString("base64"),
      audio_format: audioFormat,
    };
    if (transcript) audioItem.text = transcript;

    const result = await this.post(
      "/api/v1/mega_tts/audio/upload",
      {
        appid: this.config.appId,
        speaker_id: this.config.speakerId,
        audios: [audioItem],
        source: 2,
        language: 0,
        model_type: this.config.modelType,
        extra_params: JSON.stringify({ enable_audio_denoise: false }),
      },
      this.config.cloneResourceId,
    );
    const audioSha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    return { ...result, audioSha256 };
  }

  status(): Promise<JsonObject> {
    return this.post(
      "/api/v1/mega_tts/status",
      { appid: this.config.appId, speaker_id: this.config.speakerId },
      this.config.cloneResourceId,
    );
  }

  async waitUntilReady(timeoutMs = 180_000): Promise<JsonObject> {
    const deadline = Date.now() + timeoutMs;
    let intervalMs = 2_000;
    while (Date.now() < deadline) {
      const result = await this.status();
      const status = Number(result.status);
      if (status === 2 || status === 4) return result;
      if (status === 3) throw new VolcApiError("voice clone failed", false, String(result._requestId ?? ""));
      await sleep(intervalMs);
      intervalMs = Math.min(Math.round(intervalMs * 1.5), 10_000);
    }
    throw new Error("voice clone did not become ready before deadline");
  }

  async synthesize(text: string): Promise<Uint8Array> {
    const result = await this.post(
      "/api/v1/tts",
      {
        app: { appid: this.config.appId, token: "unused-but-non-empty", cluster: "volcano_tts" },
        user: { uid: "voice-clone-script" },
        audio: {
          voice_type: this.config.speakerId,
          encoding: "mp3",
          speed_ratio: 1,
          volume_ratio: 1,
          pitch_ratio: 1,
        },
        request: {
          reqid: crypto.randomUUID(),
          text,
          text_type: "plain",
          operation: "query",
        },
      },
      this.config.ttsResourceId,
    );
    if (typeof result.data !== "string" || result.data.length === 0) {
      throw new VolcApiError("TTS response has no audio data", true, String(result._requestId ?? ""));
    }
    return Uint8Array.from(Buffer.from(result.data, "base64"));
  }
}
```

`scripts/voice-clone.ts` 调用示例：

```ts
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { VolcVoiceCloneClient, type VolcVoiceConfig } from "../server/providers/voice/volcengine-client";

const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

const config: VolcVoiceConfig = {
  appId: requiredEnv("VOLC_SPEECH_APP_ID"),
  accessToken: requiredEnv("VOLC_SPEECH_ACCESS_TOKEN"),
  speakerId: requiredEnv("VOLC_SPEECH_SPEAKER_ID"),
  baseUrl: process.env.VOLC_SPEECH_BASE_URL ?? "https://openspeech.bytedance.com",
  cloneResourceId: process.env.VOLC_CLONE_RESOURCE_ID ?? "seed-icl-2.0",
  ttsResourceId: process.env.VOLC_TTS_RESOURCE_ID ?? "volc.megatts.voiceclone",
  modelType: Number(process.env.VOLC_CLONE_MODEL_TYPE ?? "4"),
  requestTimeoutMs: Number(process.env.VOICE_REQUEST_TIMEOUT_MS ?? "60000"),
};

const inputPath = resolve(".data/voice/input/training-24k-mono.wav");
const outputPath = resolve(".data/voice/output/test.mp3");
const client = new VolcVoiceCloneClient(config);

console.log(await client.upload(inputPath, "准确逐字稿"));
console.log(await client.waitUntilReady());
await mkdir(dirname(outputPath), { recursive: true });
await Bun.write(outputPath, await client.synthesize("这是一段授权范围内的试听文案。"));
console.log(`TTS output: ${outputPath}`);
```

示例中的 `print` 仅用于本地演示。生产代码应使用结构化日志，并确保响应在写日志前脱敏。

## 12. 配置文件示例

`.env.example`：

```dotenv
# 仅放变量名和无敏感默认值，不要提交真实凭据
VOLC_SPEECH_APP_ID=
VOLC_SPEECH_ACCESS_TOKEN=
VOLC_SPEECH_SPEAKER_ID=

VOLC_SPEECH_BASE_URL=https://openspeech.bytedance.com
VOLC_CLONE_UPLOAD_PATH=/api/v1/mega_tts/audio/upload
VOLC_CLONE_STATUS_PATH=/api/v1/mega_tts/status
VOLC_TTS_PATH=/api/v1/tts

# 必须按控制台中 speaker_id 所属模型核对
VOLC_CLONE_RESOURCE_ID=seed-icl-2.0
VOLC_TTS_RESOURCE_ID=volc.megatts.voiceclone
VOLC_CLONE_MODEL_TYPE=4

VOICE_OUTPUT_DIR=data/output
VOICE_LOG_LEVEL=INFO
VOICE_REQUEST_TIMEOUT_MS=60000
VOICE_POLL_TIMEOUT_MS=180000
VOICE_MAX_RETRIES=3
```

如需独立配置文件，可使用 `config/voice-clone.json`；但密钥仍只从环境变量读取：

```json
{
  "provider": "volcengine",
  "audio": {
    "sampleRate": 24000,
    "channels": 1,
    "trainingMinSeconds": 14,
    "trainingMaxSeconds": 30,
    "maxUploadMiB": 10
  },
  "tts": {
    "encoding": "mp3",
    "maxCharsPerSegment": 280,
    "speed": 1,
    "volume": 1,
    "pitch": 1
  },
  "retry": {
    "maxAttempts": 3,
    "initialWaitMs": 1000,
    "maxWaitMs": 10000
  },
  "logging": {
    "redactFields": ["authorization", "accessToken", "secretKey", "apiKey", "audioBytes"]
  }
}
```

密钥应由系统密钥管理服务、容器 Secret 或 CI Secret 注入，不要把真实值写进 JSON。

## 13. 错误处理与重试

### 13.1 分类

| 类型 | 示例 | 是否自动重试 |
| --- | --- | --- |
| 参数/音频错误 | 格式、时长、逐字稿不符、未检测到人声 | 否，修复输入 |
| 鉴权/权限错误 | token 无效、资源未开通、AppID 不匹配 | 否，修复配置 |
| 状态冲突 | 音色已激活、训练次数耗尽、模型映射错误 | 否，人工处理 |
| 限流 | HTTP 429、供应商频率限制 | 是，尊重 `Retry-After` |
| 临时服务错误 | HTTP 5xx、供应商临时错误码 | 是，指数退避 |
| 网络错误 | 连接失败、读取超时 | 查询状态后有限重试 |

常见训练业务错误包括：ASR 失败、声纹检测失败、逐字稿 WER 过高、未检测到人声、信噪比过低、音频质量过低、训练次数超限。不要把所有非零业务码都判为可重试。

### 13.2 策略

- 连接超时 5 秒，普通读取 60 秒，长任务查询使用独立总超时；
- 退避建议 `1s, 2s, 4s` 并加入 0～30% 抖动；
- 单请求最多 3 次，轮询由总超时控制；
- 上传请求发生不确定性失败时，先查询 `speaker_id` 状态；
- `429` 使用服务端 `Retry-After`；
- 401/403、明确 4xx、业务输入错误不重试；
- 每次重试沿用业务幂等键，但每个 TTS 请求使用新的 `reqid`；
- 熔断器按“接口 + 账号 + 资源 ID”隔离，避免一个配置错误拖垮所有任务。

## 14. 日志与监控

### 14.1 结构化日志字段

```json
{
  "event": "voice_clone.status",
  "provider": "volcengine",
  "request_id": "redacted-safe-request-id",
  "job_id": "internal-job-id",
  "speaker_id_hash": "sha256-prefix",
  "model": "voice-clone-2.0",
  "resource_id": "seed-icl-2.0",
  "status": "ready",
  "latency_ms": 1280,
  "attempt": 1,
  "retryable": false
}
```

不得记录：Access Token、AK/SK、完整 Authorization、API Key、Base64 音频、未脱敏的授权人身份信息、完整 `speaker_id`（非必要时）、供应商临时签名 URL。

### 14.2 指标与告警

- `voice_clone_requests_total{operation,status}`；
- `voice_clone_latency_seconds{operation}`；
- `voice_clone_training_duration_seconds`；
- `voice_clone_retry_total{reason}`；
- `voice_clone_upstream_errors_total{code}`；
- `voice_tts_chars_total{style,dialect}`；
- `voice_tts_audio_seconds_total`；
- `voice_quality_reject_total{reason}`；
- 音色槽位到期、余额/配额过低、连续鉴权失败、错误率突升告警。

关联排障时优先保留火山引擎响应的 `X-Tt-Logid` 或请求 ID。

## 15. 合规与授权

音色属于高敏感生物特征和人格权益相关数据。上线前应由法务/隐私负责人确认适用法律、合同和平台规则。

最低要求：

1. 只复刻本人声音，或取得清晰、可验证、可撤回的单独授权；
2. 授权文本写明使用目的、渠道、地区、期限、内容类型、是否商业化、是否允许生成方言/情绪内容；
3. 未成年人、员工、客户、公众人物和已故人士采用更严格审批；
4. 禁止诈骗、冒充、政治操纵、虚假代言、规避身份核验等用途；
5. 对外内容采用可感知标识，并在协议支持时启用音频 AIGC 水印；
6. 训练样本和成品使用私有存储、最小权限、传输/静态加密和明确保留期；
7. 提供撤回、停用、删除和事件响应流程，并验证供应商侧资源处理结果；
8. 所有训练、试听、激活、正式合成、下载和删除动作进入不可抵赖审计日志；
9. 日志、备份和测试夹具不能成为样本音频的隐性副本；
10. 对高风险文案做内容审核，避免让声音主体“说出”未授权观点。

建议授权记录至少包含：主体、核验方式、授权文件哈希、授权范围、签署/到期时间、撤回状态、关联 `speaker_id`、样本哈希和审批人。

## 16. 测试方案

### 16.1 单元测试

- 配置缺失、类型和范围校验；
- 音频格式、声道、采样率、时长、大小校验；
- Base64 编码和 SHA-256 稳定性；
- 供应商响应/错误码到内部状态映射；
- 敏感字段脱敏；
- 文本切段和方言/风格模板编译；
- 幂等键生成与重试判定。

### 16.2 契约测试

使用本地 Mock Server 覆盖：

- 200 + 成功业务码；
- 200 + 失败业务码；
- 401/403/429/500；
- 非 JSON、缺字段、无音频数据；
- 状态序列 `Training → Success`；
- 上传超时后查询发现任务已成功；
- TTS Base64 损坏或音频不可解码。

Mock 通过只代表客户端逻辑正确，不代表真实能力可用。

### 16.3 真实接口测试

真实测试必须使用专用测试音色、已授权录音和费用上限：

1. 查询当前账号能力和 `speaker_id`；
2. 上传一段合规音频；
3. 轮询到成功并保存供应商请求 ID；
4. 合成固定普通话文案；
5. 合成目标方言文案；
6. 合成 3 种风格文案；
7. 验证 MP3/WAV 可解码、时长非零、无明显截断；
8. 验证错误凭据、错误资源 ID、错误音频的失败路径；
9. 记录实际计费、耗时、字符数和账号配额变化。

不要在 CI 的每次提交中训练真实音色。真实接口测试应手动触发、限制并发和预算，并默认跳过不可逆的激活/首次计费动作。

### 16.4 主观质量验收

由声音主体和目标方言母语者分别评分（1～5 分）：

- 音色相似度；
- 自然度；
- 清晰度；
- 方言准确度；
- 风格符合度；
- 情绪强度；
- 漏读、错读、吞音、音色突变；
- 长段落一致性。

每个组合设定上线阈值，并保留盲测结果和模板版本。供应商响应成功不等于质量验收通过。

## 17. 部署与使用说明

### 17.1 本地 CLI

推荐命令：

```bash
bun scripts/voice-clone.ts validate .data/voice/input/training.wav
bun scripts/voice-clone.ts clone --audio .data/voice/input/training.wav \
  --transcript-file .data/voice/input/training.txt
bun scripts/voice-clone.ts status --wait
bun scripts/voice-clone.ts synthesize --text-file .data/voice/input/script.txt \
  --style documentary --dialect yue-guangzhou --output .data/voice/output/result.mp3
```

涉及首次正式合成或不可逆动作时要求显式确认：

```bash
bun scripts/voice-clone.ts synthesize --text-file .data/voice/input/script.txt --confirm-billable-use
bun scripts/voice-clone.ts activate --speaker-id S_xxx --confirm-irreversible
```

若将命令加入 `package.json`，可配置为 `"voice:clone": "bun scripts/voice-clone.ts"`，之后使用 `bun run voice:clone -- <子命令>`。真实接口探针建议单独配置为 `test:voice-clone`，与普通单元测试隔离，防止 CI 意外消耗额度或固定后付费音色。

### 17.2 容器/服务端

- 使用非 root 用户和只读根文件系统；
- 输入、输出、临时目录分别挂载，任务结束删除明文临时文件；
- 通过 Secret 注入凭据，不烘焙进镜像；
- 设置 CPU、内存、文件大小、并发和超时限制；
- API Server 只提交任务，Worker 执行上传/轮询/合成；
- 状态持久化到数据库，不依赖进程内变量；
- 输出上传私有对象存储，返回短期签名 URL；
- 对每个租户实施资源隔离、配额和速率限制；
- 停机时等待正在写入的音频完成或安全回滚。

### 17.3 发布清单

- [ ] 目标 AppID、`speaker_id`、模型类型和 Resource ID 已真实核对；
- [ ] 训练、状态、TTS 三个接口均用测试账号实测；
- [ ] 预付费/后付费和首次合成规则已确认；
- [ ] 授权、撤回、删除、审计流程已上线；
- [ ] 日志无密钥和 Base64 音频；
- [ ] 限流、重试、幂等、超时和熔断已测试；
- [ ] 普通话、各目标方言、各风格均有质量验收；
- [ ] 成本、错误率、到期和配额告警已配置；
- [ ] 供应商故障时明确失败或切换经验证的备选 Provider，不静默降级；
- [ ] 文档中的接口版本和官方链接已在发布日期重新复核。

## 18. 已知风险与后续扩展

- 极小众方言不应仅凭“支持多方言”上线，应预留多 Provider 路由；
- Provider 路由依据必须是“音色 + 方言 + 风格”的真实验收矩阵；
- 可扩展异步长文本、HTTP Chunked/WebSocket 流式、音频水印验证、SSML、多音字词典和人工质检工作台；
- 如果后续接入项目现有 API/Worker，应保持 Server 只投递任务，Worker 处理外部语音调用，并通过统一 OpenAPI 契约向前端暴露任务状态；
- 所有 Mock 或未验证能力必须显式标记为 `mock` / `unverified`，不可伪装成真实可用。
