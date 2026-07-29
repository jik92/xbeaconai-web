import { providerCredentials } from "../byok/credential-store";
import { env } from "../env";
import { ARK_API_BASE_URL } from "./ark-seedance";

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ArkVideoAnalysisInput {
  videoPath: string;
  prompt: string;
  mimeType?: string;
  model: string;
  productImages?: Array<{ path: string; mimeType: string }>;
}

export interface ArkVideoAnalysisFailure {
  code: "ARK_VIDEO_NETWORK_ERROR" | "ARK_VIDEO_UPSTREAM_ERROR" | "ARK_VIDEO_INVALID_RESPONSE";
  errorType: string;
  message: string;
  durationMs: number;
  httpStatus?: number;
  upstreamRequestId?: string;
  responseBody?: string;
}

function sanitizeDiagnostic(value: string, limit = 1_000) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED_SECRET]")
    .replace(/https?:\/\/[^\s"']+/gi, "[REDACTED_URL]")
    .replace(/data:[^\s"']+/gi, "[REDACTED_INLINE_DATA]")
    .replace(/\s+/g, " ")
    .slice(0, limit);
}

export class ArkVideoAnalysisError extends Error {
  constructor(readonly failure: ArkVideoAnalysisFailure) {
    super(failure.message);
    this.name = "ArkVideoAnalysisError";
  }
}

async function asDataUrl(path: string, mimeType: string) {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error("VIDEO_ANALYSIS_REFERENCE_FILE_NOT_FOUND");
  return {
    size: file.size,
    url: `data:${mimeType};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`,
  };
}

export class ArkVideoAnalysisClient {
  constructor(
    private readonly baseUrl = ARK_API_BASE_URL,
    private readonly configuredApiKey?: string,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {}

  private get apiKey() {
    return this.configuredApiKey ?? providerCredentials.get("ARK_API_KEY") ?? "";
  }

  async analyzeVideo(input: ArkVideoAnalysisInput) {
    const startedAt = Date.now();
    const apiKey = this.apiKey;
    if (!apiKey || !this.baseUrl) throw new Error("ARK_NOT_CONFIGURED");
    if (env.blockAiOutbound) throw new Error("AI_OUTBOUND_BLOCKED:ark-video-analysis");

    const video = await asDataUrl(input.videoPath, input.mimeType ?? "video/mp4");
    const productImages = await Promise.all(
      (input.productImages ?? []).map(async (image) => ({
        mimeType: image.mimeType,
        ...(await asDataUrl(image.path, image.mimeType)),
      })),
    );
    if (video.size + productImages.reduce((total, image) => total + image.size, 0) > 20 * 1024 * 1024)
      throw new Error("ARK_VIDEO_ANALYSIS_INLINE_LIMIT_EXCEEDED");

    let response: Response;
    try {
      response = await this.fetchImplementation(new URL("chat/completions", `${this.baseUrl.replace(/\/$/, "")}/`), {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: input.model,
          messages: [
            {
              role: "user",
              content: [
                { type: "video_url", video_url: { url: video.url } },
                ...productImages.map((image) => ({ type: "image_url", image_url: { url: image.url } })),
                { type: "text", text: input.prompt },
              ],
            },
          ],
          temperature: 0.1,
          max_tokens: 8_192,
        }),
        signal: AbortSignal.timeout(240_000),
      });
    } catch (error) {
      const message = sanitizeDiagnostic(error instanceof Error ? error.message : String(error), 500);
      throw new ArkVideoAnalysisError({
        code: "ARK_VIDEO_NETWORK_ERROR",
        errorType: error instanceof Error ? error.name : typeof error,
        message: `火山 Ark 视频理解请求未建立连接：${message}`,
        durationMs: Date.now() - startedAt,
      });
    }

    const upstreamRequestId = response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? undefined;
    const raw = await response.text().catch((error) => {
      throw new ArkVideoAnalysisError({
        code: "ARK_VIDEO_NETWORK_ERROR",
        errorType: error instanceof Error ? error.name : typeof error,
        message: "火山 Ark 视频理解响应读取失败",
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        upstreamRequestId,
      });
    });
    if (!response.ok) {
      throw new ArkVideoAnalysisError({
        code: "ARK_VIDEO_UPSTREAM_ERROR",
        errorType: "HttpError",
        message: `火山 Ark 视频理解返回 HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        upstreamRequestId,
        responseBody: sanitizeDiagnostic(raw),
      });
    }
    try {
      const body = JSON.parse(raw) as { model?: string; choices?: Array<{ message?: { content?: string } }> };
      const text = body.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error("EMPTY_CONTENT");
      return { text, model: body.model ?? input.model };
    } catch (error) {
      throw new ArkVideoAnalysisError({
        code: "ARK_VIDEO_INVALID_RESPONSE",
        errorType: error instanceof Error ? error.name : typeof error,
        message: "火山 Ark 视频理解未返回解析文本",
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        upstreamRequestId,
        responseBody: sanitizeDiagnostic(raw),
      });
    }
  }
}

export const arkVideoAnalysis = new ArkVideoAnalysisClient();
