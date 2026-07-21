import { describe, expect, test } from "bun:test";
import { VolcSmsClient, VolcSmsError } from "../../server/accounts/volc-sms";

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
