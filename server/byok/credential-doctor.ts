import { createHash } from "node:crypto";
import TosClient from "@volcengine/tos-sdk";
import { env } from "../env";
import { AihubmixClient } from "../providers/aihubmix";
import { ArkSeedanceClient } from "../providers/ark-seedance";
import {
  type ProviderCredentialName,
  type ProviderId,
  providerCredentials,
  type StoredCredentialCheck,
} from "./credential-store";

export type CredentialDoctorStatus = "available" | "missing" | "invalid" | "timeout";

export interface CredentialDoctorResult {
  providerId: ProviderId;
  provider: string;
  status: CredentialDoctorStatus;
  message: string;
  latencyMs: number;
  checkedAt: string;
}

export type CredentialValues = Partial<Record<ProviderCredentialName, string>>;
export type CredentialProbe = (values: CredentialValues, signal: AbortSignal) => Promise<string>;

export interface CredentialDoctorProvider {
  providerId: ProviderId;
  provider: string;
  credentials: ProviderCredentialName[];
  probe: CredentialProbe;
}

class InvalidCredentialError extends Error {}
class DoctorTimeoutError extends Error {}
export const PROVIDER_DOCTOR_TIMEOUT_MS = 30_000;

export interface TosDoctorConfig {
  region: string;
  bucket: string;
  serverEndpoint: string;
  publicEndpoint: string;
  corsOrigins: string[];
}

export interface TosDoctorClient {
  headBucket: (bucket?: string) => Promise<unknown>;
  getBucketCORS: (input: { bucket: string }) => Promise<{
    data: {
      CORSRules?: Array<{
        AllowedOrigins: string[];
        AllowedMethods: string[];
      }>;
    };
  }>;
  getPreSignedUrl: (input: { bucket: string; key: string; method: "GET"; expires: number }) => string;
}
export type TosDoctorClientFactory = (values: CredentialValues, endpoint: string) => TosDoctorClient;

export function tosDoctorConfigurationFingerprint(config: TosDoctorConfig = env.tos) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...config,
        corsOrigins: [...config.corsOrigins].sort(),
      }),
    )
    .digest("hex");
}

export function createTosDoctorProvider(
  config: TosDoctorConfig = env.tos,
  createClient: TosDoctorClientFactory = (values, endpoint) =>
    new TosClient({
      accessKeyId: values.TOS_ACCESS_KEY_ID ?? "",
      accessKeySecret: values.TOS_SECRET_ACCESS_KEY ?? "",
      region: config.region,
      endpoint,
      bucket: config.bucket,
      secure: true,
      connectionTimeout: 8_000,
      requestTimeout: 8_000,
      maxRetryCount: 0,
    }),
): CredentialDoctorProvider {
  const access = async (operation: () => Promise<unknown>, label: string) => {
    try {
      await operation();
    } catch (error) {
      if (error instanceof Error && /timeout|timed? out/i.test(`${error.name} ${error.message}`))
        throw new DoctorTimeoutError(`${label}检测超时`);
      throw new InvalidCredentialError(`${label}无法访问 Bucket ${config.bucket}`);
    }
  };
  return {
    providerId: "tos",
    provider: "火山 TOS",
    credentials: ["TOS_ACCESS_KEY_ID", "TOS_SECRET_ACCESS_KEY"],
    probe: async (values) => {
      const serverClient = createClient(values, config.serverEndpoint);
      const publicClient = createClient(values, config.publicEndpoint);
      const corsTask = (async () => {
        try {
          return (await serverClient.getBucketCORS({ bucket: config.bucket })).data.CORSRules ?? [];
        } catch (error) {
          if (error instanceof Error && /timeout|timed? out/i.test(`${error.name} ${error.message}`))
            throw new DoctorTimeoutError("Bucket CORS 检测超时");
          throw new InvalidCredentialError("无法读取 Bucket CORS 配置");
        }
      })();
      const [, , rules] = await Promise.all([
        access(() => serverClient.headBucket(config.bucket), "服务端 Endpoint "),
        config.publicEndpoint === config.serverEndpoint
          ? Promise.resolve()
          : access(() => publicClient.headBucket(config.bucket), "公网 Endpoint "),
        corsTask,
      ]);
      const requiredMethods = ["GET", "HEAD", "PUT"];
      const missingOrigins = config.corsOrigins.filter(
        (origin) =>
          !rules.some(
            (rule) =>
              rule.AllowedOrigins.includes(origin) &&
              requiredMethods.every((method) => (rule.AllowedMethods as string[]).includes(method)),
          ),
      );
      if (missingOrigins.length)
        throw new InvalidCredentialError(`Bucket CORS 缺少 Origin 或 GET/HEAD/PUT：${missingOrigins.join("、")}`);
      const signedUrl = publicClient.getPreSignedUrl({
        bucket: config.bucket,
        key: "__credential-doctor__/public-route-check",
        method: "GET",
        expires: 60,
      });
      const expectedHost = `${config.bucket}.${config.publicEndpoint}`;
      if (new URL(signedUrl).hostname !== expectedHost)
        throw new InvalidCredentialError(`公网签名 URL 未使用 ${expectedHost}`);
      return `Bucket ${config.bucket} 可用（${config.region}，Server=${config.serverEndpoint}，Public=${config.publicEndpoint}）`;
    },
  };
}

export function validateAihubmixBaseUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) throw new Error("invalid URL");
    return url.toString();
  } catch {
    throw new InvalidCredentialError("BASE URL 必须是有效的 HTTPS 地址");
  }
}

const safeJson = async (response: Response) => {
  try {
    return (await response.json()) as {
      code?: number;
      message?: string;
      success?: boolean;
      error?: { code?: string; message?: string };
    };
  } catch {
    return {};
  }
};

export const qwenAudioDoctorProvider: CredentialDoctorProvider = {
  providerId: "qwen-audio",
  provider: "Qwen Audio",
  credentials: ["QWEN_AUDIO_API_KEY", "QWEN_AUDIO_WORKSPACE_ID"],
  probe: async (values, signal) => {
    const workspaceId = values.QWEN_AUDIO_WORKSPACE_ID ?? "";
    const response = await fetch(
      `https://${workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${values.QWEN_AUDIO_API_KEY ?? ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "qwen-audio-3.0-tts-plus",
          input: { text: "", voice: "longanlingxin", format: "wav", sample_rate: 24_000 },
        }),
        signal,
      },
    );
    const payload = await safeJson(response);
    if (
      response.status === 401 ||
      response.status === 403 ||
      /invalid.+key|unauthorized|permission|workspace|forbidden/i.test(`${payload.code ?? ""} ${payload.message ?? ""}`)
    )
      throw new InvalidCredentialError("鉴权失败，请检查 API Key、Workspace ID 和北京地域");
    if (response.ok || response.status === 400) return "鉴权与 Qwen Audio 业务空间可用";
    throw new InvalidCredentialError("Qwen Audio 接口未通过可用性检查");
  },
};

export const volcSpeechDoctorProvider: CredentialDoctorProvider = {
  providerId: "volc-speech",
  provider: "火山语音",
  credentials: ["VOLC_SPEECH_API_KEY_ID", "VOLC_SPEECH_API_KEY"],
  probe: async (values, signal) => {
    const response = await fetch(`${env.volcSpeech.baseUrl.replace(/\/$/, "")}/api/v3/tts/unidirectional`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Api-Key": values.VOLC_SPEECH_API_KEY ?? "",
        "X-Api-Resource-Id": env.volcSpeech.presetTtsResourceId,
        "X-Api-Request-Id": crypto.randomUUID(),
      },
      body: JSON.stringify({
        req_params: {
          text: "你好",
          speaker: "zh_female_vv_uranus_bigtts",
          model: "seed-tts-2.0-standard",
          audio_params: { format: "mp3", sample_rate: 24_000, speech_rate: 0 },
        },
      }),
      signal,
    });
    const payload = await response.text();
    if (
      response.status === 401 ||
      response.status === 403 ||
      /invalid.+key|unauthorized|permission|forbidden|resource.+not.+granted/i.test(payload)
    )
      throw new InvalidCredentialError("鉴权失败，请检查 API Key、API Key ID 和语音资源权限");
    if (response.ok && /"code"\s*:\s*0/.test(payload)) return "鉴权与预设语音合成可用";
    throw new InvalidCredentialError("火山语音接口未通过可用性检查");
  },
};

export const activeCredentialDoctorProviders: CredentialDoctorProvider[] = [
  {
    providerId: "aihubmix",
    provider: "AIHubMix",
    credentials: ["OPENAI_KEY", "OPENAI_BASE_URL"],
    probe: async (values, signal) => {
      const baseUrl = validateAihubmixBaseUrl(values.OPENAI_BASE_URL ?? "");
      const models = await new AihubmixClient(baseUrl, values.OPENAI_KEY).listModels(signal);
      return `鉴权通过，可读取 ${models.length} 个模型`;
    },
  },
  {
    providerId: "ark",
    provider: "火山方舟",
    credentials: ["ARK_API_KEY"],
    probe: async (values, signal) => {
      const models = await new ArkSeedanceClient(undefined, values.ARK_API_KEY).listModels(signal);
      return `鉴权通过，可读取 ${models.length} 个模型`;
    },
  },
  volcSpeechDoctorProvider,
  qwenAudioDoctorProvider,
  createTosDoctorProvider(),
  {
    providerId: "mediakit",
    provider: "AI MediaKit",
    credentials: ["MEDIAKIT_API_KEY"],
    probe: async (values, signal) => {
      const response = await fetch(`${env.mediaKit.baseUrl.replace(/\/$/, "")}/api/v1/tasks/__credential_doctor__`, {
        headers: { Authorization: `Bearer ${values.MEDIAKIT_API_KEY ?? ""}`, "Content-Type": "application/json" },
        signal,
      });
      const payload = await safeJson(response);
      const errorText = `${payload.error?.code ?? ""} ${payload.error?.message ?? ""}`;
      if (
        response.status === 401 ||
        response.status === 403 ||
        /permission|forbidden|invalid.+key|unauthorized/i.test(errorText)
      )
        throw new InvalidCredentialError("鉴权失败或未开通 AI MediaKit 权限");
      if (response.ok || response.status === 404 || /not.?found/i.test(errorText)) return "鉴权通过，任务查询接口可用";
      throw new InvalidCredentialError("AI MediaKit 接口未通过可用性检查");
    },
  },
  {
    providerId: "qianchuan",
    provider: "巨量千川",
    credentials: ["QIANCHUAN_APP_ID", "QIANCHUAN_APP_SECRET"],
    probe: async (values) => {
      if (!/^\d{8,24}$/.test(values.QIANCHUAN_APP_ID ?? "")) throw new InvalidCredentialError("APP ID 格式不正确");
      if ((values.QIANCHUAN_APP_SECRET ?? "").length < 16) throw new InvalidCredentialError("APP Secret 格式不正确");
      return "应用凭据已配置，需完成商户 OAuth 授权";
    },
  },
];

export class CredentialDoctor {
  constructor(
    private readonly getCredential: (name: ProviderCredentialName) => string | undefined = (name) =>
      providerCredentials.get(name),
    private readonly providers: CredentialDoctorProvider[] = activeCredentialDoctorProviders,
    private readonly timeoutMs = PROVIDER_DOCTOR_TIMEOUT_MS,
    private readonly persistResults: (results: StoredCredentialCheck[]) => void = () => {},
  ) {}

  async runAll(): Promise<CredentialDoctorResult[]> {
    const results = await Promise.all(this.providers.map((provider) => this.check(provider)));
    this.persistResults(results);
    return results;
  }

  async runProvider(providerId: ProviderId): Promise<CredentialDoctorResult> {
    const provider = this.providers.find((candidate) => candidate.providerId === providerId);
    if (!provider) throw new Error(`PROVIDER_DOCTOR_NOT_FOUND:${providerId}`);
    const result = await this.check(provider);
    this.persistResults([result]);
    return result;
  }

  private async check(provider: CredentialDoctorProvider): Promise<CredentialDoctorResult> {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();
    const values = Object.fromEntries(
      provider.credentials.map((name) => [name, this.getCredential(name)?.trim() ?? ""]),
    ) as CredentialValues;
    const missing = provider.credentials.filter((name) => !values[name]);
    if (missing.length)
      return {
        providerId: provider.providerId,
        provider: provider.provider,
        status: "missing",
        message: `缺少 ${missing.join("、")}`,
        latencyMs: Date.now() - startedAt,
        checkedAt,
      };

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const message = await Promise.race([
        provider.probe(values, controller.signal),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new DoctorTimeoutError("检测超时"));
          }, this.timeoutMs);
        }),
      ]);
      return {
        providerId: provider.providerId,
        provider: provider.provider,
        status: "available",
        message,
        latencyMs: Date.now() - startedAt,
        checkedAt,
      };
    } catch (error) {
      const timedOut =
        controller.signal.aborted || error instanceof DoctorTimeoutError || error instanceof DOMException;
      return {
        providerId: provider.providerId,
        provider: provider.provider,
        status: timedOut ? "timeout" : "invalid",
        message: timedOut
          ? `检测超过 ${Math.ceil(this.timeoutMs / 1_000)} 秒`
          : error instanceof InvalidCredentialError
            ? error.message
            : "Provider 连接或鉴权失败",
        latencyMs: Date.now() - startedAt,
        checkedAt,
      };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

export const credentialDoctor = new CredentialDoctor(
  (name) => providerCredentials.get(name),
  activeCredentialDoctorProviders,
  PROVIDER_DOCTOR_TIMEOUT_MS,
  (results) => providerCredentials.saveChecks(results),
);
