import { Buffer } from "node:buffer";
import { GoogleGenAI } from "@google/genai";
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

export interface AihubmixImageInput {
  prompt: string;
  model: string;
  size: string;
  count: number;
  quality?: string;
}

export interface AihubmixImageEditInput extends AihubmixImageInput {
  images: Array<{ bytes: Uint8Array; mimeType: string; name: string }>;
}

export interface AihubmixPredictionImageInput extends AihubmixImageInput {
  imageUrls: string[];
}

export interface AihubmixImageResult {
  b64Json?: string;
  url?: string;
  revisedPrompt?: string;
  mimeType?: string;
}

export interface AihubmixGeminiImageInput {
  prompt: string;
  model: string;
  aspectRatio: string;
  imageSize: "1K" | "2K" | "4K";
  images: Array<{ bytes: Uint8Array; mimeType: string; name: string }>;
}

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type GeminiClient = {
  interactions: { create(input: unknown): Promise<unknown> };
  models: { generateContent(input: unknown): Promise<unknown> };
};
type GeminiFactory = (options: { apiKey: string; baseUrl: string }) => GeminiClient;

function defaultGeminiFactory(options: { apiKey: string; baseUrl: string }): GeminiClient {
  return new GoogleGenAI({
    apiKey: options.apiKey,
    httpOptions: { baseUrl: options.baseUrl },
  }) as unknown as GeminiClient;
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
    private readonly baseUrl: string = env.openaiBaseUrl || "https://aihubmix.com",
    private readonly configuredApiKey?: string,
    private readonly fetchFn: Fetch = fetch,
    private readonly geminiFactory: GeminiFactory = defaultGeminiFactory,
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
        const response = await this.fetchFn(new URL(path, this.baseUrl), {
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

  private async imageResults(path: string, init: RequestInit) {
    const body = (await this.request(path, {
      ...init,
    }).then((response) => response.json())) as {
      data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
    };
    const results = (body.data ?? [])
      .filter((item) => Boolean(item.b64_json || item.url))
      .map(
        (item): AihubmixImageResult => ({
          ...(item.b64_json ? { b64Json: item.b64_json } : {}),
          ...(item.url ? { url: item.url } : {}),
          ...(item.revised_prompt ? { revisedPrompt: item.revised_prompt } : {}),
        }),
      );
    if (!results.length) throw new Error("AIHUBMIX_INVALID_IMAGE_RESULT");
    return results;
  }

  async generateImages(input: AihubmixImageInput) {
    return this.imageResults("/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        n: input.count,
        size: input.size,
        ...(input.quality ? { quality: input.quality } : {}),
      }),
    });
  }

  async editImages(input: AihubmixImageEditInput) {
    if (!input.images.length) throw new Error("AIHUBMIX_IMAGE_EDIT_REQUIRES_IMAGE");
    const body = new FormData();
    body.set("model", input.model);
    body.set("prompt", input.prompt);
    body.set("size", input.size);
    body.set("n", String(input.count));
    if (input.quality) body.set("quality", input.quality);
    for (const image of input.images) {
      const bytes = new Uint8Array(image.bytes.byteLength);
      bytes.set(image.bytes);
      body.append("image[]", new File([bytes.buffer], image.name, { type: image.mimeType }));
    }
    return this.imageResults("/v1/images/edits", { method: "POST", body });
  }

  async generateSeedreamImages(input: AihubmixPredictionImageInput) {
    if (!/^doubao-seedream-[A-Za-z0-9.-]+$/.test(input.model)) throw new Error("AIHUBMIX_INVALID_SEEDREAM_MODEL");
    const sequential = input.count > 1 ? "auto" : "disabled";
    const body = (await this.request(`/v1/models/doubao/${encodeURIComponent(input.model)}/predictions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: {
          model: input.model,
          prompt: input.prompt,
          ...(input.imageUrls.length
            ? { image: input.imageUrls.length === 1 ? input.imageUrls[0] : input.imageUrls }
            : {}),
          size: input.size,
          sequential_image_generation: sequential,
          ...(input.count > 1 ? { sequential_image_generation_options: { max_images: input.count } } : {}),
          stream: false,
          response_format: "url",
          watermark: false,
        },
      }),
    }).then((response) => response.json())) as {
      id?: string;
      status?: string;
      output?: string | string[];
      data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
    };
    const output = typeof body.output === "string" ? [body.output] : body.output;
    const results: AihubmixImageResult[] = [
      ...(output ?? []).filter(Boolean).map((url) => ({ url })),
      ...(body.data ?? []).flatMap((item) =>
        item.b64_json || item.url
          ? [
              {
                ...(item.b64_json ? { b64Json: item.b64_json } : {}),
                ...(item.url ? { url: item.url } : {}),
                ...(item.revised_prompt ? { revisedPrompt: item.revised_prompt } : {}),
              },
            ]
          : [],
      ),
    ];
    if (results.length) return results;
    if (body.id || body.status) throw new Error("AIHUBMIX_IMAGE_PREDICTION_NOT_COMPLETED");
    throw new Error("AIHUBMIX_INVALID_IMAGE_RESULT");
  }

  private geminiClient() {
    const apiKey = this.apiKey;
    if (!apiKey || !this.baseUrl) throw new Error("AIHUBMIX_NOT_CONFIGURED");
    if (env.blockAiOutbound) throw new Error("AI_OUTBOUND_BLOCKED:/gemini");
    return this.geminiFactory({
      apiKey,
      baseUrl: new URL("/gemini", this.baseUrl).toString().replace(/\/$/, ""),
    });
  }

  private validateGeminiInput(input: AihubmixGeminiImageInput) {
    const totalBytes = input.images.reduce((total, image) => total + image.bytes.byteLength, 0);
    if (totalBytes > 20 * 1024 * 1024) throw new Error("AIHUBMIX_GEMINI_INLINE_LIMIT_EXCEEDED");
  }

  async generateGeminiInteractionImages(input: AihubmixGeminiImageInput) {
    this.validateGeminiInput(input);
    if (input.images.length) throw new Error("AIHUBMIX_GEMINI_INTERACTIONS_REFERENCES_UNSUPPORTED");
    const response = (await this.geminiClient().interactions.create({
      model: input.model,
      input: input.prompt,
      response_modalities: ["text", "image"],
      response_format: {
        type: "image",
        aspect_ratio: input.aspectRatio,
        image_size: input.imageSize,
      },
    })) as {
      output_image?: { data?: string; mime_type?: string; mimeType?: string };
      outputImage?: { data?: string; mime_type?: string; mimeType?: string };
    };
    const image = response.output_image ?? response.outputImage;
    if (!image?.data) throw new Error("AIHUBMIX_INVALID_IMAGE_RESULT");
    return [
      {
        b64Json: image.data,
        mimeType: image.mime_type ?? image.mimeType ?? "image/png",
      },
    ];
  }

  async generateGeminiContentImages(input: AihubmixGeminiImageInput) {
    this.validateGeminiInput(input);
    const response = (await this.geminiClient().models.generateContent({
      model: input.model,
      contents: [
        {
          role: "user",
          parts: [
            { text: input.prompt },
            ...input.images.map((image) => ({
              inlineData: {
                data: Buffer.from(image.bytes).toString("base64"),
                mimeType: image.mimeType,
              },
            })),
          ],
        },
      ],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: input.aspectRatio,
          imageSize: input.imageSize,
        },
      },
    })) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { data?: string; mimeType?: string; mime_type?: string };
            inline_data?: { data?: string; mimeType?: string; mime_type?: string };
          }>;
        };
      }>;
    };
    const results = (response.candidates ?? []).flatMap((candidate) =>
      (candidate.content?.parts ?? []).flatMap((part) => {
        const image = part.inlineData ?? part.inline_data;
        return image?.data
          ? [
              {
                b64Json: image.data,
                mimeType: image.mimeType ?? image.mime_type ?? "image/png",
              },
            ]
          : [];
      }),
    );
    if (!results.length) throw new Error("AIHUBMIX_INVALID_IMAGE_RESULT");
    return results;
  }

  async generateImage(prompt: string, model = "gpt-image-1-mini") {
    const [item] = await this.generateImages({
      prompt,
      model,
      count: 1,
      size: "1024x1024",
      quality: "low",
    });
    if (!item) throw new Error("AIHUBMIX_INVALID_IMAGE_RESULT");
    return {
      b64_json: item.b64Json,
      url: item.url,
      revised_prompt: item.revisedPrompt,
    };
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
