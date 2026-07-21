import { providerCredentials } from "../byok/credential-store";
import { env } from "../env";

export type MediaKitTool = "erase-video-subtitle-pro" | "enhance-video-fast";

export interface MediaKitTask {
  success?: boolean;
  task_id?: string;
  request_id?: string;
  status?: string;
  result?: {
    video_url?: string;
    duration?: number;
    resolution?: string;
    video_codec?: string;
  };
  error?: {
    code?: string;
    message?: string;
    param?: string;
    type?: string;
  };
}

type MediaKitConfig = typeof env.mediaKit & { apiKey: string };
type MediaKitFetch = (input: string, init?: RequestInit) => Promise<Response>;

export class MediaKitError extends Error {
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

function providerError(status: number, payload: MediaKitTask) {
  const code = payload.error?.code?.trim() || `HTTP_${status}`;
  const message = payload.error?.message?.trim() || `AI MediaKit 返回 HTTP ${status}`;
  const configurationError =
    status === 401 ||
    status === 403 ||
    /access.?denied|permission|forbidden|invalid.+key|unauthorized|balance|quota/i.test(`${code} ${message}`);
  return new MediaKitError(
    `MEDIAKIT_${code}`,
    message.replace(/https?:\/\/\S+/g, "[redacted-url]"),
    !configurationError && (status === 408 || status === 429 || status >= 500),
    payload.request_id,
    status,
  );
}

export class VolcMediaKitProvider {
  constructor(
    private readonly configuredConfig?: MediaKitConfig,
    private readonly request: MediaKitFetch = fetch,
  ) {}

  private get config(): MediaKitConfig {
    return {
      ...(this.configuredConfig ?? env.mediaKit),
      apiKey: this.configuredConfig?.apiKey ?? providerCredentials.get("MEDIAKIT_API_KEY") ?? "",
    };
  }

  get configured() {
    return Boolean(this.config.apiKey.trim());
  }

  private async call(path: string, init?: RequestInit) {
    const config = this.config;
    if (!config.apiKey.trim()) throw new MediaKitError("MEDIAKIT_NOT_CONFIGURED", "AI MediaKit API Key 未配置", false);
    const response = await this.request(`${config.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
      signal: init?.signal ?? AbortSignal.timeout(60_000),
    });
    let payload: MediaKitTask;
    try {
      payload = (await response.json()) as MediaKitTask;
    } catch {
      throw new MediaKitError(
        "MEDIAKIT_INVALID_RESPONSE",
        `AI MediaKit 返回了无法解析的响应（HTTP ${response.status}）`,
        response.status >= 500,
        undefined,
        response.status,
      );
    }
    if (!response.ok || payload.success === false) throw providerError(response.status, payload);
    return payload;
  }

  async submit(tool: MediaKitTool, videoUrl: string) {
    const payload = await this.call(`/api/v1/tools/${tool}`, {
      method: "POST",
      body: JSON.stringify({ video_url: videoUrl }),
    });
    if (!payload.task_id)
      throw new MediaKitError("MEDIAKIT_TASK_ID_MISSING", "AI MediaKit 未返回 task_id", true, payload.request_id);
    return { taskId: payload.task_id, requestId: payload.request_id };
  }

  retrieve(taskId: string) {
    return this.call(`/api/v1/tasks/${encodeURIComponent(taskId)}`);
  }

  async download(url: string) {
    const response = await this.request(url, { signal: AbortSignal.timeout(5 * 60_000) });
    if (!response.ok)
      throw new MediaKitError(
        "MEDIAKIT_RESULT_DOWNLOAD_FAILED",
        `AI MediaKit 结果下载返回 HTTP ${response.status}`,
        response.status === 408 || response.status === 429 || response.status >= 500,
        undefined,
        response.status,
      );
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength) throw new MediaKitError("MEDIAKIT_RESULT_EMPTY", "AI MediaKit 结果文件为空", true);
    return bytes;
  }
}

export const volcMediaKit = new VolcMediaKitProvider();
