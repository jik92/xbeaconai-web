export interface SmsMessage {
  phone: string;
  code: string;
  purpose: "register";
  expiresAt: string;
}

export interface SmsSender {
  send(message: SmsMessage): Promise<void>;
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
