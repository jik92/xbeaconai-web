import type { QwenVoiceDialect, QwenVoiceSpeed, QwenVoiceStyle } from "../../shared/voice/qwen-voice";
import { qwenVoiceInstruction } from "../../shared/voice/qwen-voice";
import { providerCredentials } from "../byok/credential-store";

interface QwenAudioConfig {
  apiKey: string;
  workspaceId: string;
}

type QwenAudioFetch = (input: string, init?: RequestInit) => Promise<Response>;

interface QwenAudioResponse {
  request_id?: string;
  output?: {
    voice_id?: string;
    audio?: { url?: string };
  };
  code?: string;
  message?: string;
}

export class QwenAudioError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly requestId?: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

function providerError(status: number, payload: QwenAudioResponse) {
  const code = payload.code?.trim() || `HTTP_${status}`;
  const configurationError =
    status === 401 || status === 403 || /invalid.+key|unauthorized|permission|workspace|forbidden/i.test(code);
  return new QwenAudioError(
    `QWEN_AUDIO_${code}`,
    payload.message?.trim() || `Qwen Audio 返回 HTTP ${status}`,
    !configurationError && (status === 408 || status === 429 || status >= 500),
    payload.request_id,
    status,
  );
}

export class QwenAudioProvider {
  constructor(
    private readonly configuredConfig?: QwenAudioConfig,
    private readonly request: QwenAudioFetch = fetch,
  ) {}

  private get config(): QwenAudioConfig {
    return (
      this.configuredConfig ?? {
        apiKey: providerCredentials.get("QWEN_AUDIO_API_KEY") ?? "",
        workspaceId: providerCredentials.get("QWEN_AUDIO_WORKSPACE_ID") ?? "",
      }
    );
  }

  get configured() {
    const config = this.config;
    return Boolean(config.apiKey.trim() && config.workspaceId.trim());
  }

  private async call(path: string, body: Record<string, unknown>) {
    const config = this.config;
    if (!config.apiKey.trim() || !config.workspaceId.trim())
      throw new QwenAudioError("QWEN_AUDIO_NOT_CONFIGURED", "Qwen Audio API Key 或 Workspace ID 未配置", false);
    const response = await this.request(
      `https://${config.workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/${path}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      },
    );
    let payload: QwenAudioResponse;
    try {
      payload = (await response.json()) as QwenAudioResponse;
    } catch {
      throw new QwenAudioError(
        "QWEN_AUDIO_INVALID_RESPONSE",
        `Qwen Audio 返回了无法解析的响应（HTTP ${response.status}）`,
        response.status >= 500,
        undefined,
        response.status,
      );
    }
    if (!response.ok) throw providerError(response.status, payload);
    return payload;
  }

  async createVoice(audioUrl: string, prefix: string) {
    const payload = await this.call("customization", {
      model: "voice-enrollment",
      input: {
        action: "create_voice",
        target_model: "qwen-audio-3.0-tts-plus",
        prefix,
        url: audioUrl,
      },
    });
    const voiceId = payload.output?.voice_id?.trim();
    if (!voiceId)
      throw new QwenAudioError(
        "QWEN_AUDIO_VOICE_ID_MISSING",
        "Qwen Audio 创建音色成功但未返回 Voice ID",
        true,
        payload.request_id,
      );
    return { voiceId, requestId: payload.request_id };
  }

  async synthesize(input: {
    voiceId: string;
    text: string;
    dialect: QwenVoiceDialect;
    style: QwenVoiceStyle;
    speed: QwenVoiceSpeed;
  }) {
    const payload = await this.call("SpeechSynthesizer", {
      model: "qwen-audio-3.0-tts-plus",
      input: {
        text: input.text,
        voice: input.voiceId,
        format: "wav",
        sample_rate: 24_000,
        language_hints: ["zh"],
        instruction: qwenVoiceInstruction(input.dialect, input.style, input.speed),
      },
    });
    const audioUrl = payload.output?.audio?.url?.trim();
    if (!audioUrl)
      throw new QwenAudioError(
        "QWEN_AUDIO_RESULT_MISSING",
        "Qwen Audio 合成成功但未返回音频地址",
        true,
        payload.request_id,
      );
    return { audioUrl, requestId: payload.request_id };
  }

  async download(url: string) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.request(url, { signal: AbortSignal.timeout(60_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength < 256) throw new Error("empty audio");
        return bytes;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await Bun.sleep(500 * (attempt + 1));
      }
    }
    throw new QwenAudioError(
      "QWEN_AUDIO_DOWNLOAD_FAILED",
      "Qwen Audio 试听音频下载失败",
      true,
      undefined,
      lastError instanceof Error ? undefined : 500,
    );
  }
}

export const qwenAudio = new QwenAudioProvider();
