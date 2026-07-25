import { providerCredentials } from "../byok/credential-store";
import { env } from "../env";
import type { SeedanceModelId, SeedanceReferenceKind } from "../models/video-models";

export const ARK_API_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

export interface ArkSeedanceReference {
  kind: SeedanceReferenceKind;
  url: string;
}

export interface ArkSeedanceVideoInput {
  model: SeedanceModelId;
  prompt: string;
  references?: ArkSeedanceReference[];
  resolution?: "480p" | "720p" | "1080p";
  ratio?: "adaptive" | "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9";
  duration?: 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;
  generateAudio?: boolean;
  watermark?: boolean;
}

export interface ArkSeedanceTask {
  id: string;
  model?: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired" | string;
  content?: {
    video_url?: string;
    last_frame_url?: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
  created_at?: number;
  updated_at?: number;
}

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function buildArkSeedanceReferenceContent(references: ArkSeedanceReference[] = []) {
  return references.map((reference) => {
    if (reference.kind === "image") {
      return {
        type: "image_url" as const,
        image_url: { url: reference.url },
        role: "reference_image" as const,
      };
    }
    if (reference.kind === "video") {
      return {
        type: "video_url" as const,
        video_url: { url: reference.url },
        role: "reference_video" as const,
      };
    }
    return {
      type: "audio_url" as const,
      audio_url: { url: reference.url },
      role: "reference_audio" as const,
    };
  });
}

export function buildArkSeedanceVideoRequest(input: ArkSeedanceVideoInput) {
  return {
    model: input.model,
    content: [{ type: "text" as const, text: input.prompt }, ...buildArkSeedanceReferenceContent(input.references)],
    generate_audio: input.generateAudio ?? false,
    resolution: input.resolution ?? "720p",
    ratio: input.ratio ?? "16:9",
    duration: input.duration ?? 5,
    watermark: input.watermark ?? false,
  };
}

export class ArkSeedanceClient {
  constructor(
    private readonly baseUrl = ARK_API_BASE_URL,
    private readonly configuredApiKey?: string,
    private readonly fetchImplementation: FetchImplementation = fetch,
  ) {}

  private get apiKey() {
    return this.configuredApiKey ?? providerCredentials.get("ARK_API_KEY") ?? "";
  }

  get configured() {
    return Boolean(this.apiKey && this.baseUrl);
  }

  private async request(path: string, init: RequestInit = {}) {
    const apiKey = this.apiKey;
    if (!apiKey || !this.baseUrl) throw new Error("ARK_NOT_CONFIGURED");
    if (env.blockAiOutbound) throw new Error(`AI_OUTBOUND_BLOCKED:${path}`);
    const method = (init.method ?? "GET").toUpperCase();
    const retryableMethod = method === "GET" || method === "HEAD";
    const attempts = retryableMethod ? 4 : 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await this.fetchImplementation(new URL(path, `${this.baseUrl.replace(/\/$/, "")}/`), {
          ...init,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            ...init.headers,
          },
          signal: init.signal ?? AbortSignal.timeout(120_000),
        });
        if (response.ok) return response;
        const message = (await response.text()).slice(0, 1_000);
        const error = new Error(`ARK_${response.status}: ${message}`);
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

  async listModels(signal?: AbortSignal) {
    const body = (await this.request("models", { signal }).then((response) => response.json())) as {
      data?: Array<{ id: string }>;
    };
    return body.data ?? [];
  }

  async createVideo(input: ArkSeedanceVideoInput) {
    const task = (await this.request("contents/generations/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildArkSeedanceVideoRequest(input)),
      signal: AbortSignal.timeout(180_000),
    }).then((response) => response.json())) as ArkSeedanceTask;
    if (!task.id) throw new Error("ARK_INVALID_VIDEO_TASK");
    return task;
  }

  async getVideo(id: string) {
    return this.request(`contents/generations/tasks/${encodeURIComponent(id)}`).then((response) =>
      response.json(),
    ) as Promise<ArkSeedanceTask>;
  }

  async cancelVideo(id: string) {
    try {
      await this.request(`contents/generations/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
      return "requested" as const;
    } catch (error) {
      if (error instanceof Error && /ARK_(404|405|501):/.test(error.message)) return "unsupported" as const;
      throw error;
    }
  }

  async waitForVideo(id: string, timeoutMs = 20 * 60_000, pollIntervalMs = 5_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const task = await this.getVideo(id);
      if (task.status === "succeeded") {
        if (!task.content?.video_url) throw new Error("ARK_VIDEO_URL_MISSING");
        return task;
      }
      if (["failed", "cancelled", "expired"].includes(task.status))
        throw new Error(`ARK_VIDEO_${task.status}: ${JSON.stringify(task.error ?? {})}`);
      await Bun.sleep(pollIntervalMs);
    }
    throw new Error("ARK_VIDEO_TIMEOUT");
  }

  async downloadVideo(url: string, timeoutMs = 10 * 60_000) {
    const response = await this.fetchImplementation(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`ARK_VIDEO_DOWNLOAD_${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 1_024) throw new Error("ARK_INVALID_VIDEO_RESULT");
    return { bytes, mimeType: response.headers.get("content-type") ?? "video/mp4" };
  }
}

export const arkSeedance = new ArkSeedanceClient();
