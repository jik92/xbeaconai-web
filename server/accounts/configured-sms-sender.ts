import { APP_CONFIG } from "../../web/app/config";
import { providerCredentials } from "../byok/credential-store";
import { env } from "../env";
import { ConsoleSmsSender, type SmsMessage, SmsProviderError, type SmsSender } from "./sms-sender";
import { type SmsFetch, VolcSmsClient, VolcSmsError } from "./volc-sms";

export class ConfiguredVolcSmsSender implements SmsSender {
  constructor(
    private readonly getCredential: (name: "TOS_ACCESS_KEY_ID" | "TOS_SECRET_ACCESS_KEY") => string | undefined = (
      name,
    ) => providerCredentials.get(name),
    private readonly fetcher: SmsFetch = fetch,
  ) {}

  async send(message: SmsMessage) {
    const accessKeyId = this.getCredential("TOS_ACCESS_KEY_ID") ?? "";
    const secretAccessKey = this.getCredential("TOS_SECRET_ACCESS_KEY") ?? "";
    if (!accessKeyId || !secretAccessKey) throw new SmsProviderError("火山短信 Access Key 未配置");

    const client = new VolcSmsClient(
      {
        accessKeyId,
        secretAccessKey,
        ...APP_CONFIG.providerDefaults.volcSms,
      },
      this.fetcher,
    );
    try {
      await client.sendCode(message.phone, message.code);
    } catch (error) {
      if (error instanceof VolcSmsError) throw new SmsProviderError(error.message, error.requestId);
      throw new SmsProviderError(error instanceof Error ? error.message : "火山短信请求失败");
    }
  }
}

export function createApplicationSmsSender(): SmsSender {
  return env.smsVerificationFixedCode ? new ConsoleSmsSender() : new ConfiguredVolcSmsSender();
}
