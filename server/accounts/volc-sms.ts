import { createHash, createHmac } from "node:crypto";
import type { SmsMessage, SmsSender } from "./sms-sender";

const DEFAULT_ENDPOINT = "https://sms.volcengineapi.com";
const API_VERSION = "2020-01-01";
const SERVICE = "volcSMS";
const REGION = "cn-north-1";

export interface VolcSmsConfig {
  accessKeyId: string;
  secretAccessKey: string;
  smsAccount: string;
  sign: string;
  templateId: string;
  endpoint?: string;
}

export interface VolcSmsResult {
  requestId?: string;
  messageIds: string[];
}

export type SmsFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface VolcSmsResponse {
  ResponseMetadata?: {
    RequestId?: string;
    Error?: { Code?: string; Message?: string };
  };
  Result?: {
    MessageID?: string[];
    MessageId?: string[];
  };
}

export class VolcSmsError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "VolcSmsError";
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();

export class VolcSmsClient {
  constructor(
    private readonly config: VolcSmsConfig,
    private readonly fetcher: SmsFetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async sendCode(phone: string, code: string): Promise<VolcSmsResult> {
    const endpoint = new URL(this.config.endpoint ?? DEFAULT_ENDPOINT);
    const body = JSON.stringify({
      SmsAccount: this.config.smsAccount,
      Sign: this.config.sign,
      TemplateID: this.config.templateId,
      TemplateParam: JSON.stringify({ code }),
      PhoneNumbers: phone,
    });
    const xDate = this.now()
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, "");
    const shortDate = xDate.slice(0, 8);
    const payloadHash = sha256(body);
    const canonicalHeaders = [
      "content-type:application/json",
      `host:${endpoint.host}`,
      `x-content-sha256:${payloadHash}`,
      `x-date:${xDate}`,
      "",
    ].join("\n");
    const signedHeaders = "content-type;host;x-content-sha256;x-date";
    const canonicalRequest = [
      "POST",
      endpoint.pathname || "/",
      `Action=SendSms&Version=${API_VERSION}`,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const credentialScope = `${shortDate}/${REGION}/${SERVICE}/request`;
    const stringToSign = ["HMAC-SHA256", xDate, credentialScope, sha256(canonicalRequest)].join("\n");
    const dateKey = hmac(this.config.secretAccessKey, shortDate);
    const regionKey = hmac(dateKey, REGION);
    const serviceKey = hmac(regionKey, SERVICE);
    const signingKey = hmac(serviceKey, "request");
    const signature = hmac(signingKey, stringToSign).toString("hex");
    const authorization = [
      `HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(", ");

    const response = await this.fetcher(new URL(`?Action=SendSms&Version=${API_VERSION}`, endpoint), {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        Host: endpoint.host,
        "X-Content-Sha256": payloadHash,
        "X-Date": xDate,
      },
      body,
    });
    const payload = (await response.json().catch(() => undefined)) as VolcSmsResponse | undefined;
    const requestId = payload?.ResponseMetadata?.RequestId;
    const upstreamError = payload?.ResponseMetadata?.Error;
    if (!response.ok || upstreamError) {
      throw new VolcSmsError(
        upstreamError?.Code ?? `HTTP_${response.status}`,
        upstreamError?.Message ?? `火山短信接口请求失败（HTTP ${response.status}）`,
        requestId,
      );
    }

    return {
      requestId,
      messageIds: payload?.Result?.MessageID ?? payload?.Result?.MessageId ?? [],
    };
  }
}

export class VolcSmsSender implements SmsSender {
  private readonly client: VolcSmsClient;

  constructor(config: VolcSmsConfig, fetcher?: SmsFetch) {
    this.client = new VolcSmsClient(config, fetcher);
  }

  async send(message: SmsMessage): Promise<void> {
    await this.client.sendCode(message.phone, message.code);
  }
}
