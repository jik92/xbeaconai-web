import { describe, expect, test } from "bun:test";
import type { CredentialDoctorResult } from "../../server/byok/credential-doctor";
import { refreshTosDoctorForStartup, type TosStartupDoctorDependencies } from "../../server/byok/tos-startup-doctor";

const result = (status: CredentialDoctorResult["status"]): CredentialDoctorResult => ({
  providerId: "tos",
  provider: "火山 TOS",
  status,
  message: status === "available" ? "上海 TOS 可用" : "上海 TOS 不可用",
  latencyMs: 8,
  checkedAt: "2026-07-27T00:00:00.000Z",
});

const dependencies = (overrides: Partial<TosStartupDoctorDependencies> = {}): TosStartupDoctorDependencies => ({
  isProduction: true,
  fingerprint: "tos-config-v1",
  ensureContext: () => false,
  runDoctor: async () => result("available"),
  log: () => undefined,
  ...overrides,
});

describe("TOS startup Doctor", () => {
  test("does not require TOS network access during local startup", async () => {
    let called = false;
    let contextChecked = false;
    const output = await refreshTosDoctorForStartup(
      "worker",
      dependencies({
        isProduction: false,
        ensureContext: () => {
          contextChecked = true;
          return true;
        },
        runDoctor: async () => {
          called = true;
          return result("invalid");
        },
      }),
    );
    expect(output).toBeUndefined();
    expect(called).toBe(false);
    expect(contextChecked).toBe(true);
  });

  test("invalidates stale context and refreshes TOS before production startup", async () => {
    let receivedFingerprint = "";
    const output = await refreshTosDoctorForStartup(
      "api",
      dependencies({
        ensureContext: (fingerprint) => {
          receivedFingerprint = fingerprint;
          return true;
        },
      }),
    );
    expect(receivedFingerprint).toBe("tos-config-v1");
    expect(output?.status).toBe("available");
  });

  test("keeps the production API available for remediation when TOS fails", async () => {
    const output = await refreshTosDoctorForStartup("api", dependencies({ runDoctor: async () => result("invalid") }));
    expect(output?.status).toBe("invalid");
  });

  test("refuses to start the production Worker when TOS fails", async () => {
    expect(
      refreshTosDoctorForStartup("worker", dependencies({ runDoctor: async () => result("timeout") })),
    ).rejects.toThrow("TOS_STARTUP_DOCTOR_TIMEOUT");
  });
});
