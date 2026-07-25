import { Buffer } from "node:buffer";
import { providerCredentials } from "../byok/credential-store";
import { env } from "../env";

export interface AihubmixModel {
  model_id: string;
  types?: string;
  input_modalities?: string;
  features?: string;
  pricing?: Record<string, number>;
}

export interface GptImageAnalysisInput {
  images: Array<{ bytes: Uint8Array; mimeType: string }>;
  prompt: string;
  model: string;
  maxTokens?: number;
}

export function buildGptImageAnalysisContent(input: GptImageAnalysisInput) {
  return [
    { type: "text" as const, text: input.prompt },
    ...input.images.map((image) => ({
      type: "image_url" as const,
      image_url: { url: `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString("base64")}` },
    })),
  ];
}

export function buildGptImageAnalysisRequest(input: GptImageAnalysisInput) {
  return {
    model: input.model,
    messages: [{ role: "user" as const, content: buildGptImageAnalysisContent(input) }],
    response_format: { type: "json_object" as const },
    max_completion_tokens: input.maxTokens ?? 4_096,
  };
}

export class AihubmixClient {
  constructor(
    private readonly baseUrl = env.openaiBaseUrl || "https://aihubmix.com",
    private readonly configuredApiKey?: string,
  ) {}

  private get apiKey() {
    return this.configuredApiKey ?? providerCredentials.get("OPENAI_KEY") ?? "";
  }

  get configured() {
    return Boolean(this.apiKey && this.baseUrl);
  }

  private async request(path: string, init: RequestInit = {}) {
    const apiKey = this.apiKey;
    if (!apiKey || !this.baseUrl) throw new Error("AIHUBMIX_NOT_CONFIGURED");
    if (env.blockAiOutbound) throw new Error(`AI_OUTBOUND_BLOCKED:${path}`);
    const method = (init.method ?? "GET").toUpperCase();
    const retryableMethod = method === "GET" || method === "HEAD" || method === "DELETE";
    const attempts = retryableMethod ? 4 : 1;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await fetch(new URL(path, this.baseUrl), {
          ...init,
          headers: { Authorization: `Bearer ${apiKey}`, ...init.headers },
          signal: init.signal ?? AbortSignal.timeout(120_000),
        });
        if (response.ok) return response;
        const message = (await response.text()).slice(0, 1000);
        const error = new Error(`AIHUBMIX_${response.status}: ${message}`);
        if (!retryableMethod || ![408, 429, 500, 502, 503, 504].includes(response.status)) {
          Object.assign(error, { safeRetry: false });
          throw error;
        }
        lastError = error;
      } catch (error) {
        lastError = error;
        if (
          init.signal?.aborted ||
          !retryableMethod ||
          (error instanceof Error && (error as Error & { safeRetry?: boolean }).safeRetry === false) ||
          attempt === attempts - 1
        )
          throw error;
      }
      await Bun.sleep(500 * 2 ** attempt);
    }
    throw lastError;
  }

  async listModels(timeout?: number | AbortSignal) {
    const body = (await this.request("/api/v1/models", {
      signal: typeof timeout === "number" ? AbortSignal.timeout(timeout) : timeout,
    }).then((response) => response.json())) as {
      data?: AihubmixModel[];
    };
    return body.data ?? [];
  }

  async generateText(
    prompt: string,
    model = "gpt-4.1-nano-free",
    options: { maxTokens?: number; temperature?: number; json?: boolean; timeoutMs?: number } = {},
  ) {
    const body = (await this.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: options.maxTokens ?? 160,
        temperature: options.temperature ?? 0.4,
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
      }),
    }).then((response) => response.json())) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: unknown;
    };
    const text = body.choices?.[0]?.message?.content;
    if (!text) throw new Error("AIHUBMIX_INVALID_TEXT_RESULT");
    return { text, model: body.model ?? model, usage: body.usage };
  }

  async generateImage(prompt: string, model = "gpt-image-1-mini") {
    const body = (await this.request("/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, n: 1, size: "1024x1024", quality: "low" }),
    }).then((response) => response.json())) as {
      data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
    };
    const item = body.data?.[0];
    if (!item?.b64_json && !item?.url) throw new Error("AIHUBMIX_INVALID_IMAGE_RESULT");
    return item;
  }

  async analyzeImages(input: GptImageAnalysisInput) {
    if (!input.images.length) throw new Error("IMAGE_ANALYSIS_REQUIRES_IMAGE");
    if (input.images.reduce((total, image) => total + image.bytes.byteLength, 0) > 20 * 1024 * 1024)
      throw new Error("IMAGE_ANALYSIS_INLINE_LIMIT_EXCEEDED");
    const body = (await this.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify(buildGptImageAnalysisRequest(input)),
    }).then((response) => response.json())) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: unknown;
    };
    const text = body.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("AIHUBMIX_INVALID_IMAGE_ANALYSIS_RESULT");
    return { text, model: body.model ?? input.model, usage: body.usage };
  }

  async synthesizeSpeech(input: string, model = "tts-1", voice = "alloy") {
    const response = await this.request("/v1/audio/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, voice, input, response_format: "wav" }),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 256) throw new Error("AIHUBMIX_INVALID_AUDIO_RESULT");
    return { bytes, mimeType: response.headers.get("content-type") ?? "audio/wav" };
  }
}

export const aihubmix = new AihubmixClient();
