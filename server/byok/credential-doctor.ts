import TosClient from "@volcengine/tos-sdk";
import { AihubmixClient } from "../providers/aihubmix";
import { env } from "../env";
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

const defaultProviders: CredentialDoctorProvider[] = [
  {
    providerId: "aihubmix",
    provider: "AIHubMix",
    credentials: ["OPENAI_KEY"],
    probe: async (values, signal) => {
      const models = await new AihubmixClient(env.openaiBaseUrl, values.OPENAI_KEY).listModels(8_000).then((result) => {
        if (signal.aborted) throw new DoctorTimeoutError("检测超时");
        return result;
      });
      return `鉴权通过，可读取 ${models.length} 个模型`;
    },
  },
  {
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
            text: "",
            speaker: "zh_female_vv_uranus_bigtts",
            model: "seed-tts-2.0-standard",
            audio_params: { format: "mp3", sample_rate: 24_000 },
          },
        }),
        signal,
      });
      const payload = await safeJson(response);
      if (response.status === 401 || response.status === 403)
        throw new InvalidCredentialError("鉴权失败，请检查 API Key 和资源授权");
      if (payload.code === 0 || payload.code === 45_002_001) return "鉴权与预置语音资源可用";
      if (/permission|forbidden|invalid.+key|not.?granted|resource/i.test(payload.message ?? ""))
        throw new InvalidCredentialError("API Key 有效，但语音资源未授权或配置错误");
      throw new InvalidCredentialError("语音接口未通过可用性检查");
    },
  },
  {
    providerId: "tos",
    provider: "火山 TOS",
    credentials: ["TOS_ACCESS_KEY_ID", "TOS_SECRET_ACCESS_KEY"],
    probe: async (values) => {
      const client = new TosClient({
        accessKeyId: values.TOS_ACCESS_KEY_ID ?? "",
        accessKeySecret: values.TOS_SECRET_ACCESS_KEY ?? "",
        region: env.tos.region,
        endpoint: env.tos.endpoint,
        bucket: env.tos.bucket,
        secure: true,
        connectionTimeout: 8_000,
        requestTimeout: 8_000,
        maxRetryCount: 0,
      });
      try {
        await client.headBucket(env.tos.bucket);
      } catch (error) {
        if (error instanceof Error && /timeout|timed? out/i.test(`${error.name} ${error.message}`))
          throw new DoctorTimeoutError("检测超时");
        throw new InvalidCredentialError("无法访问配置的 TOS Bucket");
      }
      return "凭证与 Bucket 访问权限可用";
    },
  },
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
];

export class CredentialDoctor {
  constructor(
    private readonly getCredential: (name: ProviderCredentialName) => string | undefined = (name) =>
      providerCredentials.get(name),
    private readonly providers: CredentialDoctorProvider[] = defaultProviders,
    private readonly timeoutMs = 10_000,
    private readonly persistResults: (results: StoredCredentialCheck[]) => void = () => {},
  ) {}

  async runAll(): Promise<CredentialDoctorResult[]> {
    const results = await Promise.all(this.providers.map((provider) => this.check(provider)));
    this.persistResults(results);
    return results;
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
  defaultProviders,
  10_000,
  (results) => providerCredentials.saveChecks(results),
);
