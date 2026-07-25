import { describe, expect, test } from "bun:test";
import { ConfiguredVolcSmsSender } from "../../server/accounts/configured-sms-sender";
import { SmsProviderError } from "../../server/accounts/sms-sender";
import { VolcSmsClient, VolcSmsError } from "../../server/accounts/volc-sms";
import { APP_CONFIG } from "../../web/app/config";

const config = {
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  smsAccount: "test-account",
  sign: "测试签名",
  templateId: "test-template",
  endpoint: "https://sms.example.test",
};

describe("VolcSmsClient", () => {
  test("signs and sends a template code request", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const client = new VolcSmsClient(
      config,
      async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return Response.json({
          ResponseMetadata: { RequestId: "request-1" },
          Result: { MessageID: ["message-1"] },
        });
      },
      () => new Date("2026-07-21T11:06:37.000Z"),
    );

    const result = await client.sendCode("13800000000", "123456");

    expect(capturedUrl).toBe("https://sms.example.test/?Action=SendSms&Version=2020-01-01");
    expect(new Headers(capturedInit?.headers).get("Authorization")).toStartWith(
      "HMAC-SHA256 Credential=test-access-key/20260721/cn-north-1/volcSMS/request",
    );
    expect(new Headers(capturedInit?.headers).get("X-Date")).toBe("20260721T110637Z");
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      SmsAccount: "test-account",
      Sign: "测试签名",
      TemplateID: "test-template",
      TemplateParam: JSON.stringify({ code: "123456" }),
      PhoneNumbers: "13800000000",
    });
    expect(result).toEqual({ requestId: "request-1", messageIds: ["message-1"] });
  });

  test("surfaces provider errors without exposing credentials", async () => {
    const client = new VolcSmsClient(config, async () =>
      Response.json({
        ResponseMetadata: {
          RequestId: "request-2",
          Error: { Code: "RE:0005", Message: "模板错误" },
        },
      }),
    );

    const error = await client.sendCode("13800000000", "123456").catch((caught) => caught);

    expect(error).toBeInstanceOf(VolcSmsError);
    expect(error).toMatchObject({ code: "RE:0005", message: "模板错误", requestId: "request-2" });
    expect(String(error)).not.toContain(config.secretAccessKey);
  });
});

describe("ConfiguredVolcSmsSender", () => {
  test("uses the shared production template for registration and password reset", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const sender = new ConfiguredVolcSmsSender(
      (name) => (name === "TOS_ACCESS_KEY_ID" ? "test-access-key" : "test-secret-key"),
      async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({ Result: { MessageID: ["message-1"] } });
      },
    );

    const registrationDelivery = await sender.send({
      phone: "13800000000",
      code: "123456",
      purpose: "register",
      expiresAt: "2026-07-22T15:00:00.000Z",
    });
    const resetDelivery = await sender.send({
      phone: "13800000001",
      code: "654321",
      purpose: "reset_password",
      expiresAt: "2026-07-22T15:00:00.000Z",
    });

    expect(bodies.map((body) => body.TemplateID)).toEqual([
      APP_CONFIG.providerDefaults.volcSms.templateId,
      APP_CONFIG.providerDefaults.volcSms.templateId,
    ]);
    expect(APP_CONFIG.providerDefaults.volcSms.templateId).toBe("SPT_09a29a26");
    expect(registrationDelivery).toBe("sent");
    expect(resetDelivery).toBe("sent");
  });

  test("displays the code without a provider request when either access key is unavailable", async () => {
    let providerRequests = 0;
    const message = {
      phone: "13800000000",
      code: "123456",
      purpose: "register" as const,
      expiresAt: "2026-07-22T15:00:00.000Z",
    };
    const fetcher = async () => {
      providerRequests += 1;
      return Response.json({ Result: { MessageID: ["message-1"] } });
    };
    const missingBoth = new ConfiguredVolcSmsSender(() => undefined, fetcher);
    const missingId = new ConfiguredVolcSmsSender(
      (name) => (name === "TOS_SECRET_ACCESS_KEY" ? "test-secret-key" : undefined),
      fetcher,
    );
    const missingSecret = new ConfiguredVolcSmsSender(
      (name) => (name === "TOS_ACCESS_KEY_ID" ? "test-access-key" : undefined),
      fetcher,
    );

    expect(await missingBoth.send(message)).toBe("display");
    expect(await missingId.send(message)).toBe("display");
    expect(await missingSecret.send(message)).toBe("display");
    expect(providerRequests).toBe(0);
  });

  test("does not fall back to display when configured provider delivery fails", async () => {
    const sender = new ConfiguredVolcSmsSender(
      (name) => (name === "TOS_ACCESS_KEY_ID" ? "test-access-key" : "test-secret-key"),
      async () =>
        Response.json({
          ResponseMetadata: { Error: { Code: "RE:0005", Message: "模板错误" } },
        }),
    );

    const error = await sender
      .send({ phone: "13800000000", code: "123456", purpose: "register", expiresAt: "2026-07-22T15:00:00.000Z" })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(SmsProviderError);
    expect(error).toMatchObject({ message: "模板错误" });
  });
});
