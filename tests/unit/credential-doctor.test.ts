import { describe, expect, test } from "bun:test";
import {
  CredentialDoctor,
  type CredentialDoctorProvider,
  type CredentialValues,
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
  test("reports available, missing, invalid and timeout without exposing provider errors", async () => {
    const values: Partial<Record<ProviderCredentialName, string>> = {
      OPENAI_KEY: "openai-secret",
      TOS_ACCESS_KEY_ID: "tos-id",
      MEDIAKIT_API_KEY: "mediakit-secret",
      VOLC_SPEECH_API_KEY_ID: "speech-id",
      VOLC_SPEECH_API_KEY: "speech-secret",
    };
    let persisted: Awaited<ReturnType<CredentialDoctor["runAll"]>> = [];
    const doctor = new CredentialDoctor(
      (name) => values[name],
      providers,
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
    expect(JSON.stringify(results)).not.toContain("upstream secret");
    expect(JSON.stringify(results)).not.toContain("openai-secret");
    expect(persisted).toEqual(results);
  });
});
