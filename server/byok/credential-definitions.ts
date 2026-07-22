export const providerCredentialNames = [
  "OPENAI_KEY",
  "VOLC_SPEECH_API_KEY_ID",
  "VOLC_SPEECH_API_KEY",
  "TOS_ACCESS_KEY_ID",
  "TOS_SECRET_ACCESS_KEY",
  "MEDIAKIT_API_KEY",
] as const;

export type ProviderCredentialName = (typeof providerCredentialNames)[number];

export const providerIds = ["aihubmix", "volc-speech", "tos", "mediakit"] as const;
export type ProviderId = (typeof providerIds)[number];

export const providerCredentialCatalog = [
  {
    name: "OPENAI_KEY",
    providerId: "aihubmix",
    provider: "AIHubMix",
    label: "OpenAI-compatible API Key",
    secret: true,
  },
  {
    name: "VOLC_SPEECH_API_KEY_ID",
    providerId: "volc-speech",
    provider: "火山语音",
    label: "API Key ID",
    secret: false,
  },
  { name: "VOLC_SPEECH_API_KEY", providerId: "volc-speech", provider: "火山语音", label: "API Key", secret: true },
  { name: "TOS_ACCESS_KEY_ID", providerId: "tos", provider: "火山 TOS", label: "Access Key ID", secret: false },
  { name: "TOS_SECRET_ACCESS_KEY", providerId: "tos", provider: "火山 TOS", label: "Secret Access Key", secret: true },
  { name: "MEDIAKIT_API_KEY", providerId: "mediakit", provider: "AI MediaKit", label: "API Key", secret: true },
] as const satisfies ReadonlyArray<{
  name: ProviderCredentialName;
  providerId: ProviderId;
  provider: string;
  label: string;
  secret: boolean;
}>;

export function providerIdForCredential(name: ProviderCredentialName): ProviderId {
  const credential = providerCredentialCatalog.find((item) => item.name === name);
  if (!credential) throw new Error(`Unknown provider credential: ${name}`);
  return credential.providerId;
}
