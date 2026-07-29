import { providerCredentials } from "../byok/credential-store";
import { env } from "../env";
import { ARK_API_BASE_URL } from "./ark-seedance";

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ArkMultimodalTextInput {
  prompt: string;
  model: string;
  images: Array<{ path: string; mimeType: string; label: string }>;
  maxTokens: number;
  temperature: number;
  json: boolean;
  timeoutMs: number;
}

async function imageDataUrl(path: string, mimeType: string) {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error("ARK_MULTIMODAL_IMAGE_NOT_FOUND");
  return {
    size: file.size,
    url: `data:${mimeType};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`,
  };
}

export class ArkMultimodalTextClient {
  constructor(
    private readonly baseUrl = ARK_API_BASE_URL,
    private readonly configuredApiKey?: string,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {}

  private get apiKey() {
    return this.configuredApiKey ?? providerCredentials.get("ARK_API_KEY") ?? "";
  }

  async generate(input: ArkMultimodalTextInput) {
    const apiKey = this.apiKey;
    if (!apiKey || !this.baseUrl) throw new Error("ARK_NOT_CONFIGURED");
    if (env.blockAiOutbound) throw new Error("AI_OUTBOUND_BLOCKED:ark-multimodal-text");
    const images = await Promise.all(
      input.images.map(async (image) => ({
        ...image,
        ...(await imageDataUrl(image.path, image.mimeType)),
      })),
    );
    if (images.reduce((total, image) => total + image.size, 0) > 20 * 1024 * 1024)
      throw new Error("ARK_MULTIMODAL_INLINE_LIMIT_EXCEEDED");

    const content = [
      { type: "text", text: input.prompt },
      ...images.flatMap((image) => [
        { type: "text", text: `${image.label}：商品参考图，只能提取图中真实可见的商品特征。` },
        { type: "image_url", image_url: { url: image.url } },
      ]),
    ];
    const response = await this.fetchImplementation(
      new URL("chat/completions", `${this.baseUrl.replace(/\/$/, "")}/`),
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: input.model,
          messages: [{ role: "user", content }],
          max_tokens: input.maxTokens,
          temperature: input.temperature,
          ...(input.json ? { response_format: { type: "json_object" } } : {}),
          thinking: { type: "disabled" },
        }),
        signal: AbortSignal.timeout(input.timeoutMs),
      },
    );
    const raw = await response.text();
    if (!response.ok) throw new Error(`ARK_${response.status}: ${raw.slice(0, 1_000)}`);
    const body = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: unknown;
    };
    const text = body.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("ARK_INVALID_MULTIMODAL_TEXT_RESULT");
    return { text, model: body.model ?? input.model, usage: body.usage };
  }
}

export const arkMultimodalText = new ArkMultimodalTextClient();
