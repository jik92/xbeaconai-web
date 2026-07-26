import { env } from "../env";
import { type CredentialDoctorResult, credentialDoctor, tosDoctorConfigurationFingerprint } from "./credential-doctor";
import { providerCredentials } from "./credential-store";

export type TosStartupRole = "api" | "worker";

export interface TosStartupDoctorDependencies {
  isProduction: boolean;
  fingerprint: string;
  ensureContext: (fingerprint: string) => boolean;
  runDoctor: () => Promise<CredentialDoctorResult>;
  log: (message: string) => void;
}

const defaultDependencies = (): TosStartupDoctorDependencies => ({
  isProduction: env.isProduction,
  fingerprint: tosDoctorConfigurationFingerprint(env.tos),
  ensureContext: (fingerprint) => providerCredentials.ensureProviderCheckContext("tos", fingerprint),
  runDoctor: () => credentialDoctor.runProvider("tos"),
  log: (message) => console.log(message),
});

export async function refreshTosDoctorForStartup(
  role: TosStartupRole,
  dependencies: TosStartupDoctorDependencies = defaultDependencies(),
) {
  const contextChanged = dependencies.ensureContext(dependencies.fingerprint);
  if (!dependencies.isProduction) {
    if (contextChanged) dependencies.log(`TOS startup Doctor (${role}): configuration changed, verification reset`);
    return undefined;
  }
  const result = await dependencies.runDoctor();
  dependencies.log(
    `TOS startup Doctor (${role}): ${result.status}${contextChanged ? ", configuration changed" : ""} - ${result.message}`,
  );
  if (role === "worker" && result.status !== "available")
    throw new Error(`TOS_STARTUP_DOCTOR_${result.status.toUpperCase()}: ${result.message}`);
  return result;
}
