import { VolcSmsClient, VolcSmsError } from "../server/accounts/volc-sms";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
};

const phone = required("VOLC_SMS_TEST_PHONE");
const code = String(Math.floor(100_000 + Math.random() * 900_000));
const client = new VolcSmsClient({
  accessKeyId: required("VOLC_SMS_ACCESS_KEY_ID"),
  secretAccessKey: required("VOLC_SMS_SECRET_ACCESS_KEY"),
  smsAccount: required("VOLC_SMS_ACCOUNT"),
  sign: required("VOLC_SMS_SIGN"),
  templateId: required("VOLC_SMS_TEMPLATE_ID"),
});

try {
  const result = await client.sendCode(phone, code);
  console.info("短信接口已受理", {
    phone: `${phone.slice(0, 3)}****${phone.slice(-4)}`,
    requestId: result.requestId,
    messageIds: result.messageIds,
  });
} catch (error) {
  if (error instanceof VolcSmsError) {
    console.error("短信接口拒绝请求", {
      code: error.code,
      message: error.message,
      requestId: error.requestId,
    });
  } else {
    console.error(error instanceof Error ? error.message : "短信发送失败");
  }
  process.exitCode = 1;
}
