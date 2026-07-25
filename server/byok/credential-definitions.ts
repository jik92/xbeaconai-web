export const providerCredentialNames = [
  "OPENAI_KEY",
  "VOLC_SPEECH_API_KEY_ID",
  "VOLC_SPEECH_API_KEY",
  "TOS_ACCESS_KEY_ID",
  "TOS_SECRET_ACCESS_KEY",
  "MEDIAKIT_API_KEY",
  "QWEN_AUDIO_API_KEY",
  "QWEN_AUDIO_WORKSPACE_ID",
] as const;

export type ProviderCredentialName = (typeof providerCredentialNames)[number];

export const providerIds = ["aihubmix", "volc-speech", "tos", "mediakit", "qwen-audio"] as const;
export type ProviderId = (typeof providerIds)[number];

export const providerCredentialCatalog = [
  {
    name: "OPENAI_KEY",
    providerId: "aihubmix",
    provider: "AIHubMix",
    label: "OpenAI-compatible API Key",
    secret: true,
    docsUrl: "https://aihubmix.mintlify.app/cn/api/Models-API",
  },
  {
    name: "VOLC_SPEECH_API_KEY_ID",
    providerId: "volc-speech",
    provider: "火山语音",
    label: "API Key ID",
    secret: false,
    docsUrl: "https://www.volcengine.com/docs/6561",
  },
  {
    name: "VOLC_SPEECH_API_KEY",
    providerId: "volc-speech",
    provider: "火山语音",
    label: "API Key",
    secret: true,
    docsUrl: "https://www.volcengine.com/docs/6561",
  },
  {
    name: "TOS_ACCESS_KEY_ID",
    providerId: "tos",
    provider: "火山 TOS",
    label: "Access Key ID",
    secret: false,
    docsUrl: "https://www.volcengine.com/docs/6349/163211?lang=zh",
  },
  {
    name: "TOS_SECRET_ACCESS_KEY",
    providerId: "tos",
    provider: "火山 TOS",
    label: "Secret Access Key",
    secret: true,
    docsUrl: "https://www.volcengine.com/docs/6349/163211?lang=zh",
  },
  {
    name: "MEDIAKIT_API_KEY",
    providerId: "mediakit",
    provider: "AI MediaKit",
    label: "API Key",
    secret: true,
    docsUrl: "https://www.volcengine.com/docs/6448/2373721",
  },
  {
    name: "QWEN_AUDIO_API_KEY",
    providerId: "qwen-audio",
    provider: "Qwen Audio",
    label: "API Key",
    secret: true,
    docsUrl: "https://help.aliyun.com/zh/model-studio/speech-synthesis-api-reference/",
  },
  {
    name: "QWEN_AUDIO_WORKSPACE_ID",
    providerId: "qwen-audio",
    provider: "Qwen Audio",
    label: "Workspace ID",
    secret: false,
    docsUrl: "https://help.aliyun.com/zh/model-studio/speech-synthesis-api-reference/",
  },
] as const satisfies ReadonlyArray<{
  name: ProviderCredentialName;
  providerId: ProviderId;
  provider: string;
  label: string;
  secret: boolean;
  docsUrl: string;
}>;

export const managedProviderCredentialCatalog = providerCredentialCatalog.filter(
  (credential) => credential.providerId !== "volc-speech",
);
export const managedProviderIds = providerIds.filter((providerId) => providerId !== "volc-speech");

export function providerIdForCredential(name: ProviderCredentialName): ProviderId {
  const credential = providerCredentialCatalog.find((item) => item.name === name);
  if (!credential) throw new Error(`Unknown provider credential: ${name}`);
  return credential.providerId;
}
