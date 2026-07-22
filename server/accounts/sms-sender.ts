export interface SmsMessage {
  phone: string;
  code: string;
  purpose: "register" | "reset_password";
  expiresAt: string;
}

export interface SmsSender {
  send(message: SmsMessage): Promise<void>;
}

export class SmsProviderError extends Error {
  constructor(
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "SmsProviderError";
  }
}

export class ConsoleSmsSender implements SmsSender {
  async send(message: SmsMessage) {
    console.info("[SMS verification]", {
      phone: message.phone,
      purpose: message.purpose,
      code: message.code,
      expiresAt: message.expiresAt,
    });
  }
}
