import { Buffer } from "node:buffer";
import { env } from "../env";

type VoiceStatus = 0 | 1 | 2 | 3 | 4;

export interface VoiceCloneStatus {
  code?: number;
  message?: string;
  available_training_times?: number;
  create_time?: number;
  language?: number;
  speaker_id?: string;
  status?: VoiceStatus;
  model_type?: number;
  demo_audio?: string;
  speaker_status?: Array<{
    model_type?: number;
    demo_audio?: string;
  }>;
}

interface VoiceSynthesisChunk {
  code?: number;
  message?: string;
  data?: string;
  reqid?: string;
}

export interface VoiceSynthesisResult {
  bytes: Uint8Array;
  logId?: string;
  requestId: string;
}

export class VolcSpeechError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly logId?: string,
  ) {
    super(message);
  }
}

type SpeakerReference = { speaker_id: string; custom_speaker_id?: string };
type VolcSpeechConfig = typeof env.volcSpeech;
type SpeechFetch = (input: string, init?: RequestInit) => Promise<Response>;

function providerError(status: number, body: { code?: number; message?: string }, logId?: string) {
  const upstreamCode = body.code ? String(body.code) : String(status);
  const message = body.message?.trim() || `火山引擎语音接口返回 HTTP ${status}`;
  const businessConfigurationError =
    /^45/.test(upstreamCode) ||
    /resource.+(mismatch|not granted)|invalid.+(key|resource|speaker)|permission|forbidden/i.test(message);
  const retryable = !businessConfigurationError && (status === 408 || status === 429 || status >= 500);
  return new VolcSpeechError(`VOLC_SPEECH_${upstreamCode}`, message, retryable, logId);
}

export class VolcSpeechProvider {
  readonly configured: boolean;

  constructor(
    private readonly config: VolcSpeechConfig = env.volcSpeech,
    private readonly request: SpeechFetch = fetch,
  ) {
    this.configured = Boolean(config.apiKey);
  }

  private async post(path: string, body: Record<string, unknown>): Promise<VoiceCloneStatus> {
    if (!this.configured) throw new VolcSpeechError("VOLC_SPEECH_NOT_CONFIGURED", "火山引擎语音 API Key 未配置", false);
    const response = await this.request(`${this.config.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Api-Key": this.config.apiKey,
        "X-Api-Request-Id": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const logId = response.headers.get("x-tt-logid") ?? undefined;
    let payload: VoiceCloneStatus;
    try {
      payload = (await response.json()) as VoiceCloneStatus;
    } catch {
      throw new VolcSpeechError("VOLC_SPEECH_INVALID_RESPONSE", "火山引擎语音接口返回了无法解析的响应", true, logId);
    }
    if (!response.ok || (payload.code !== undefined && payload.code !== 0))
      throw providerError(response.status, payload, logId);
    return payload;
  }

  train(input: {
    speaker: SpeakerReference;
    bytes: Uint8Array;
    format: string;
    transcript?: string;
    language: number;
    demoText: string;
    enableDenoise: boolean;
  }) {
    return this.post("/api/v3/tts/voice_clone", {
      ...input.speaker,
      audio: { data: Buffer.from(input.bytes).toString("base64"), format: input.format },
      text: input.transcript || undefined,
      language: input.language,
      extra_params: {
        demo_text: input.demoText,
        enable_audio_denoise: input.enableDenoise,
      },
    });
  }

  query(speaker: SpeakerReference) {
    return this.post("/api/v3/tts/get_voice", speaker);
  }

  async waitUntilReady(speaker: SpeakerReference, initial: VoiceCloneStatus, cancelled: () => boolean) {
    let current = initial;
    const deadline = Date.now() + this.config.pollTimeoutMs;
    while (current.status === 1 || current.status === undefined) {
      if (cancelled()) throw new VolcSpeechError("VOICE_CLONE_CANCELLED", "任务已取消", false);
      if (Date.now() >= deadline)
        throw new VolcSpeechError("VOICE_CLONE_TIMEOUT", "音色训练等待超时，可稍后重试查询", true);
      await Bun.sleep(this.config.pollIntervalMs);
      current = await this.query(speaker);
    }
    if (current.status !== 2 && current.status !== 4)
      throw new VolcSpeechError("VOICE_CLONE_FAILED", current.message || "音色训练失败", false);
    return current;
  }

  resultAudio(status: VoiceCloneStatus) {
    const model =
      status.speaker_status?.find((item) => item.model_type === 5 && item.demo_audio) ??
      status.speaker_status?.find((item) => item.demo_audio);
    return {
      demoAudio: model?.demo_audio ?? status.demo_audio ?? "",
      modelType: model?.model_type ?? status.model_type ?? 5,
    };
  }

  async downloadDemo(value: string) {
    const trimmed = value.trim();
    if (!trimmed) throw new VolcSpeechError("VOICE_DEMO_MISSING", "训练成功但未返回试听音频", true);
    if (/^https:\/\//i.test(trimmed)) {
      const response = await this.request(trimmed, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new VolcSpeechError("VOICE_DEMO_DOWNLOAD_FAILED", "试听音频下载失败", true);
      return new Uint8Array(await response.arrayBuffer());
    }
    const encoded = trimmed.replace(/^data:audio\/[^;]+;base64,/, "");
    try {
      const bytes = new Uint8Array(Buffer.from(encoded, "base64"));
      if (!bytes.length) throw new Error("empty audio");
      return bytes;
    } catch {
      throw new VolcSpeechError("VOICE_DEMO_INVALID", "试听音频格式无效", true);
    }
  }

  async synthesize(input: {
    requestId: string;
    resourceId: string;
    speaker: string;
    text: string;
    model: "seed-tts-2.0-standard" | "seed-tts-2.0-expressive";
    speechRate: number;
    explicitLanguage?: string;
    explicitDialect?: string;
    contextText?: string;
    toneFidelity: boolean;
  }): Promise<VoiceSynthesisResult> {
    if (!this.configured) throw new VolcSpeechError("VOLC_SPEECH_NOT_CONFIGURED", "火山引擎语音 API Key 未配置", false);
    const additions = {
      disable_markdown_filter: false,
      disable_emoji_filter: false,
      tone_fidelity: input.toneFidelity,
      explicit_language: input.explicitLanguage || undefined,
      explicit_dialect: input.explicitDialect || undefined,
      context_texts: input.contextText ? [input.contextText] : undefined,
    };
    const response = await this.request(`${this.config.baseUrl.replace(/\/$/, "")}/api/v3/tts/unidirectional`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Api-Key": this.config.apiKey,
        "X-Api-Resource-Id": input.resourceId,
        "X-Api-Request-Id": input.requestId,
      },
      body: JSON.stringify({
        req_params: {
          text: input.text,
          speaker: input.speaker,
          model: input.model,
          audio_params: { format: "mp3", sample_rate: 24_000, speech_rate: input.speechRate },
          additions: JSON.stringify(additions),
        },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const logId = response.headers.get("x-tt-logid") ?? undefined;
    const reader = response.body?.getReader();
    if (!reader) throw new VolcSpeechError("VOLC_SPEECH_EMPTY_RESPONSE", "语音合成接口没有返回响应内容", true, logId);

    const decoder = new TextDecoder();
    const audioChunks: Buffer[] = [];
    let pending = "";
    let completed = false;
    const consume = (line: string) => {
      if (!line.trim()) return;
      let chunk: VoiceSynthesisChunk;
      try {
        chunk = JSON.parse(line) as VoiceSynthesisChunk;
      } catch {
        throw new VolcSpeechError("VOLC_SPEECH_INVALID_RESPONSE", "语音合成接口返回了无法解析的数据", true, logId);
      }
      if (chunk.code === 0) {
        if (chunk.data) {
          const bytes = Buffer.from(chunk.data, "base64");
          if (bytes.length) audioChunks.push(bytes);
        }
        return;
      }
      if (chunk.code === 20_000_000) {
        completed = true;
        return;
      }
      throw providerError(response.status, chunk, logId);
    };

    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) consume(line);
      if (done) break;
    }
    consume(pending);
    if (!response.ok) throw providerError(response.status, {}, logId);
    if (!completed || !audioChunks.length)
      throw new VolcSpeechError("VOLC_SPEECH_INCOMPLETE_AUDIO", "语音合成未返回完整音频", true, logId);
    return { bytes: new Uint8Array(Buffer.concat(audioChunks)), logId, requestId: input.requestId };
  }
}

export const volcSpeech = new VolcSpeechProvider();
