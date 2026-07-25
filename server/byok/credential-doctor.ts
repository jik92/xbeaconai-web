import TosClient from "@volcengine/tos-sdk";
import { env } from "../env";
import { AihubmixClient } from "../providers/aihubmix";
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

export const activeCredentialDoctorProviders: CredentialDoctorProvider[] = [
  {
    providerId: "aihubmix",
    provider: "AIHubMix",
    credentials: ["OPENAI_KEY"],
    probe: async (values, signal) => {
      const models = await new AihubmixClient(env.openaiBaseUrl, values.OPENAI_KEY).listModels(signal);
      return `鉴权通过，可读取 ${models.length} 个模型`;
    },
  },
  qwenAudioDoctorProvider,
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
    private readonly providers: CredentialDoctorProvider[] = activeCredentialDoctorProviders,
    private readonly timeoutMs = PROVIDER_DOCTOR_TIMEOUT_MS,
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
  activeCredentialDoctorProviders,
  PROVIDER_DOCTOR_TIMEOUT_MS,
  (results) => providerCredentials.saveChecks(results),
);
