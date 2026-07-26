import { describe, expect, test } from "bun:test";
import {
  activeCredentialDoctorProviders,
  CredentialDoctor,
  type CredentialDoctorProvider,
  type CredentialDoctorResult,
  type CredentialValues,
  createTosDoctorProvider,
  PROVIDER_DOCTOR_TIMEOUT_MS,
  tosDoctorConfigurationFingerprint,
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

  test("refreshes and persists only the requested startup Provider", async () => {
    let persisted: CredentialDoctorResult[] = [];
    const doctor = new CredentialDoctor(
      () => "configured-value",
      providers.slice(0, 2),
      100,
      (results) => {
        persisted = results;
      },
    );

    const result = await doctor.runProvider("aihubmix");

    expect(result.providerId).toBe("aihubmix");
    expect(persisted.map((item) => item.providerId)).toEqual(["aihubmix"]);
  });

  test("keeps the Bun HTTP connection open long enough to return timeout results", async () => {
    const serverEntry = await Bun.file("server/index.ts").text();
    expect(serverEntry).toContain("idleTimeout: 60");
    expect(60_000).toBeGreaterThan(PROVIDER_DOCTOR_TIMEOUT_MS);
  });

  test("checks the configured TOS Server/Public routes and required CORS origins", async () => {
    const endpoints: string[] = [];
    const config = {
      region: "cn-shanghai",
      bucket: "xbeacon-shanghai",
      serverEndpoint: "tos-cn-shanghai.ivolces.com",
      publicEndpoint: "tos-cn-shanghai.volces.com",
      corsOrigins: ["http://118.196.101.57:9000"],
    };
    const provider = createTosDoctorProvider(config, (_values, endpoint) => {
      endpoints.push(endpoint);
      return {
        headBucket: async () => ({ statusCode: 200 }),
        getBucketCORS: async () => ({
          data: {
            CORSRules: [
              {
                AllowedOrigins: config.corsOrigins,
                AllowedMethods: ["GET", "HEAD", "PUT"],
                AllowedHeaders: ["*"],
                ExposeHeaders: ["ETag"],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
        getPreSignedUrl: () => `https://${config.bucket}.${config.publicEndpoint}/doctor`,
      } as never;
    });

    const message = await provider.probe(
      { TOS_ACCESS_KEY_ID: "tos-id", TOS_SECRET_ACCESS_KEY: "tos-secret" },
      new AbortController().signal,
    );

    expect(endpoints).toEqual([config.serverEndpoint, config.publicEndpoint]);
    expect(message).toContain("xbeacon-shanghai");
    expect(message).toContain(config.serverEndpoint);
    expect(message).toContain(config.publicEndpoint);
  });

  test("rejects a TOS Bucket that is missing the current runtime CORS origin", async () => {
    const config = {
      region: "cn-shanghai",
      bucket: "xbeacon-shanghai",
      serverEndpoint: "tos-cn-shanghai.volces.com",
      publicEndpoint: "tos-cn-shanghai.volces.com",
      corsOrigins: ["http://localhost:5173"],
    };
    const provider = createTosDoctorProvider(
      config,
      () =>
        ({
          headBucket: async () => ({ statusCode: 200 }),
          getBucketCORS: async () => ({ data: { CORSRules: [] } }),
          getPreSignedUrl: () => `https://${config.bucket}.${config.publicEndpoint}/doctor`,
        }) as never,
    );

    expect(
      provider.probe(
        { TOS_ACCESS_KEY_ID: "tos-id", TOS_SECRET_ACCESS_KEY: "tos-secret" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Bucket CORS 缺少 Origin");
  });

  test("binds the TOS Doctor fingerprint to endpoints, bucket and normalized CORS origins", () => {
    const base = {
      region: "cn-shanghai",
      bucket: "xbeacon-shanghai",
      serverEndpoint: "tos-cn-shanghai.volces.com",
      publicEndpoint: "tos-cn-shanghai.volces.com",
      corsOrigins: ["http://localhost:5173", "http://127.0.0.1:5173"],
    };
    expect(tosDoctorConfigurationFingerprint(base)).toBe(
      tosDoctorConfigurationFingerprint({ ...base, corsOrigins: [...base.corsOrigins].reverse() }),
    );
    expect(tosDoctorConfigurationFingerprint(base)).not.toBe(
      tosDoctorConfigurationFingerprint({ ...base, bucket: "another-bucket" }),
    );
  });
});
