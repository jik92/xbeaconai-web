import { ArkRuntimeClient } from "@volcengine/ark-runtime";
import type { MediaUnderstandModelId, MediaUnderstandReasoningEffort } from "../../shared/media-understand/contract";
import { providerCredentials } from "../byok/credential-store";
import { env } from "../env";

export type ArkUnderstandingMedia =
  | {
      kind: "image" | "video" | "audio";
      url: string;
    }
  | {
      kind: "image" | "video" | "audio";
      fileId: string;
    };

export interface ArkMediaUnderstandingInput {
  model: MediaUnderstandModelId;
  reasoningEffort: MediaUnderstandReasoningEffort;
  prompt: string;
  media: ArkUnderstandingMedia[];
}

type ArkInputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "high" }
  | { type: "input_video"; video_url: string }
  | { type: "input_audio"; audio_url: string }
  | { type: "input_image"; file_id: string; detail: "high" }
  | { type: "input_video"; file_id: string }
  | { type: "input_audio"; file_id: string };

export interface ArkMediaUnderstandingRequest {
  model: MediaUnderstandModelId;
  input: Array<{ role: "user"; content: ArkInputContent[] }>;
  thinking: { type: "disabled" | "enabled" };
  reasoning?: { effort: "medium" | "high" };
  text: { format: { type: "json_object" } };
  max_output_tokens: number;
  store: false;
}

type ArkResponsesSdk = {
  createResponses(
    request: Parameters<ArkRuntimeClient["createResponses"]>[0],
    options?: { signal?: AbortSignal },
  ): Promise<Record<string, unknown>>;
  uploadFile(
    request: { file: File; purpose: string; expire_at?: number },
    options?: { signal?: AbortSignal },
  ): Promise<{ id: string; status: string; error?: { message?: string } }>;
  retrieveFile(
    fileId: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ id: string; status: string; error?: { message?: string } }>;
  deleteFile(fileId: string, options?: { signal?: AbortSignal }): Promise<unknown>;
};

type ArkResponsesSdkFactory = (apiKey: string) => ArkResponsesSdk;

function mediaContent(item: ArkUnderstandingMedia): ArkInputContent {
  if ("fileId" in item) {
    if (item.kind === "video") return { type: "input_video", file_id: item.fileId };
    if (item.kind === "audio") return { type: "input_audio", file_id: item.fileId };
    return { type: "input_image", file_id: item.fileId, detail: "high" };
  }
  if (item.kind === "video") return { type: "input_video", video_url: item.url };
  if (item.kind === "audio") return { type: "input_audio", audio_url: item.url };
  return { type: "input_image", image_url: item.url, detail: "high" };
}

export function buildArkMediaUnderstandingRequest(input: ArkMediaUnderstandingInput): ArkMediaUnderstandingRequest {
  return {
    model: input.model,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: input.prompt }, ...input.media.map(mediaContent)],
      },
    ],
    thinking: { type: input.reasoningEffort === "off" ? "disabled" : "enabled" },
    ...(input.reasoningEffort === "off" ? {} : { reasoning: { effort: input.reasoningEffort } }),
    text: { format: { type: "json_object" } },
    max_output_tokens: 16_384,
    store: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function extractArkResponseText(response: unknown) {
  if (!isRecord(response)) throw new Error("ARK_MEDIA_UNDERSTANDING_INVALID_RESPONSE");
  if (response.status === "failed" || response.status === "incomplete")
    throw new Error(`ARK_MEDIA_UNDERSTANDING_${String(response.status).toUpperCase()}`);
  if (!Array.isArray(response.output)) throw new Error("ARK_MEDIA_UNDERSTANDING_OUTPUT_MISSING");
  const parts: string[] = [];
  for (const item of response.output) {
    if (!isRecord(item) || item.type !== "message" || item.role !== "assistant" || !Array.isArray(item.content))
      continue;
    for (const content of item.content)
      if (isRecord(content) && content.type === "output_text" && typeof content.text === "string")
        parts.push(content.text);
  }
  const text = parts.join("").trim();
  if (!text) throw new Error("ARK_MEDIA_UNDERSTANDING_TEXT_MISSING");
  return text;
}

function safeProviderError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[MEDIA_URL]")
    .replace(/(?:Bearer\s+)?[A-Za-z0-9_-]{24,}/g, "[REDACTED]")
    .slice(0, 500);
}

export class ArkMediaUnderstandingClient {
  constructor(
    private readonly configuredApiKey?: string,
    private readonly sdkFactory: ArkResponsesSdkFactory = (apiKey) => ArkRuntimeClient.withApiKey(apiKey),
  ) {}

  private get apiKey() {
    return this.configuredApiKey ?? providerCredentials.get("ARK_API_KEY") ?? "";
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  async uploadMedia(file: File) {
    if (!this.apiKey) throw new Error("ARK_NOT_CONFIGURED");
    if (env.blockAiOutbound) throw new Error("AI_OUTBOUND_BLOCKED:ark-media-upload");
    const sdk = this.sdkFactory(this.apiKey);
    const deadline = Date.now() + 10 * 60_000;
    let metadata = await sdk.uploadFile(
      {
        file,
        purpose: "user_data",
      },
      { signal: AbortSignal.timeout(10 * 60_000) },
    );
    while (metadata.status === "processing" && Date.now() < deadline) {
      await Bun.sleep(2_000);
      metadata = await sdk.retrieveFile(metadata.id, { signal: AbortSignal.timeout(30_000) });
    }
    if (metadata.status !== "active")
      throw new Error(
        `ARK_MEDIA_FILE_${metadata.status.toUpperCase()}: ${safeProviderError(metadata.error?.message ?? "文件处理失败")}`,
      );
    return metadata.id;
  }

  async deleteMedia(fileId: string) {
    if (!this.apiKey) return;
    await this.sdkFactory(this.apiKey)
      .deleteFile(fileId, { signal: AbortSignal.timeout(30_000) })
      .catch(() => undefined);
  }

  async analyze(input: ArkMediaUnderstandingInput) {
    if (!this.apiKey) throw new Error("ARK_NOT_CONFIGURED");
    if (env.blockAiOutbound) throw new Error("AI_OUTBOUND_BLOCKED:ark-media-understanding");
    const request = buildArkMediaUnderstandingRequest(input);
    let response: Record<string, unknown>;
    try {
      response = await this.sdkFactory(this.apiKey).createResponses(
        request as Parameters<ArkRuntimeClient["createResponses"]>[0],
        { signal: AbortSignal.timeout(10 * 60_000) },
      );
    } catch (error) {
      throw new Error(`ARK_MEDIA_UNDERSTANDING_ERROR: ${safeProviderError(error)}`);
    }
    return {
      text: extractArkResponseText(response),
      responseId: typeof response.id === "string" ? response.id : undefined,
      model: typeof response.model === "string" ? response.model : input.model,
      usage: isRecord(response.usage) ? response.usage : undefined,
    };
  }
}

export const arkMediaUnderstanding = new ArkMediaUnderstandingClient();
