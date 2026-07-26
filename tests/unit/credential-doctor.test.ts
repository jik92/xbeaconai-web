import { describe, expect, test } from "bun:test";
import {
  activeCredentialDoctorProviders,
  CredentialDoctor,
  type CredentialDoctorProvider,
  type CredentialValues,
  PROVIDER_DOCTOR_TIMEOUT_MS,
  validateAihubmixBaseUrl,
} from "../../server/byok/credential-doctor";
import type { ProviderCredentialName } from "../../server/byok/credential-store";

const providers: CredentialDoctorProvider[] = [
  {
    providerId: "aihubmix",
    provider: "可用服务",
    credentials: ["OPENAI_KEY"],
    probe: async () => "鉴权通过",
  },
  {
    providerId: "tos",
    provider: "缺少配置",
    credentials: ["TOS_ACCESS_KEY_ID", "TOS_SECRET_ACCESS_KEY"],
    probe: async () => "不会执行",
  },
  {
    providerId: "mediakit",
    provider: "不可用服务",
    credentials: ["MEDIAKIT_API_KEY"],
    probe: async () => Promise.reject(new Error("upstream secret must not leak")),
  },
  {
    providerId: "volc-speech",
    provider: "超时服务",
    credentials: ["VOLC_SPEECH_API_KEY_ID", "VOLC_SPEECH_API_KEY"],
    probe: async (_values: CredentialValues, signal: AbortSignal) =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }),
  },
];

describe("credential doctor", () => {
  test("checks Qwen, TOS, and Volc Speech in the active Provider list", () => {
    const providerIds = activeCredentialDoctorProviders.map((provider) => provider.providerId);
    expect(providerIds).toContain("qwen-audio");
    expect(providerIds).toContain("ark");
    expect(providerIds).toContain("tos");
    expect(providerIds).toContain("volc-speech");
    expect(activeCredentialDoctorProviders.find((provider) => provider.providerId === "aihubmix")?.credentials).toEqual(
      ["OPENAI_KEY", "OPENAI_BASE_URL"],
    );
  });

  test("requires an HTTPS AIHubMix BASE URL", () => {
    expect(validateAihubmixBaseUrl("https://api.inferera.com")).toBe("https://api.inferera.com/");
    expect(() => validateAihubmixBaseUrl("http://api.inferera.com")).toThrow("BASE URL 必须是有效的 HTTPS 地址");
  });

  test("reports available, missing, invalid and timeout without exposing provider errors", async () => {
    const values: Partial<Record<ProviderCredentialName, string>> = {
      OPENAI_KEY: "openai-secret",
      TOS_ACCESS_KEY_ID: "tos-id",
      MEDIAKIT_API_KEY: "mediakit-secret",
      VOLC_SPEECH_API_KEY_ID: "speech-id",
      VOLC_SPEECH_API_KEY: "speech-secret",
    };
    let persisted: Awaited<ReturnType<CredentialDoctor["runAll"]>> = [];
    let timeoutSignalAborted = false;
    const timeoutProvider = providers[3];
    if (!timeoutProvider) throw new Error("Timeout provider fixture is missing");
    const providersWithAbortTracking = [
      ...providers.slice(0, 3),
      {
        ...timeoutProvider,
        probe: async (providerValues: CredentialValues, signal: AbortSignal) => {
          signal.addEventListener("abort", () => {
            timeoutSignalAborted = true;
          });
          return timeoutProvider.probe(providerValues, signal);
        },
      },
    ];
    const doctor = new CredentialDoctor(
      (name) => values[name],
      providersWithAbortTracking,
      5,
      (results) => {
        persisted = results;
      },
    );

    const results = await doctor.runAll();

    expect(results.map((result) => result.status)).toEqual(["available", "missing", "invalid", "timeout"]);
    expect(results[0]?.message).toBe("鉴权通过");
    expect(results[1]?.message).toContain("TOS_SECRET_ACCESS_KEY");
    expect(results[2]?.message).toBe("Provider 连接或鉴权失败");
    expect(results[3]?.message).toBe("检测超过 1 秒");
    expect(timeoutSignalAborted).toBe(true);
    expect(JSON.stringify(results)).not.toContain("upstream secret");
    expect(JSON.stringify(results)).not.toContain("openai-secret");
    expect(persisted).toEqual(results);
  });

  test("uses a 30 second timeout for live provider checks", () => {
    expect(PROVIDER_DOCTOR_TIMEOUT_MS).toBe(30_000);
  });

  test("keeps the Bun HTTP connection open long enough to return timeout results", async () => {
    const serverEntry = await Bun.file("server/index.ts").text();
    expect(serverEntry).toContain("idleTimeout: 60");
    expect(60_000).toBeGreaterThan(PROVIDER_DOCTOR_TIMEOUT_MS);
  });
});
