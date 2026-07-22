import { VolcSmsClient, VolcSmsError } from "../server/accounts/volc-sms";
import { providerCredentials } from "../server/byok/credential-store";
import { APP_CONFIG } from "../web/app/config";

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
};

const phone = required("VOLC_SMS_TEST_PHONE");
const code = String(Math.floor(100_000 + Math.random() * 900_000));
const accessKeyId = process.env.VOLC_SMS_ACCESS_KEY_ID?.trim() || providerCredentials.get("TOS_ACCESS_KEY_ID");
const secretAccessKey =
  process.env.VOLC_SMS_SECRET_ACCESS_KEY?.trim() || providerCredentials.get("TOS_SECRET_ACCESS_KEY");
if (!accessKeyId || !secretAccessKey) throw new Error("缺少已导入的火山 Access Key，或 VOLC_SMS_ACCESS_KEY_ID 配置");
const client = new VolcSmsClient({
  accessKeyId,
  secretAccessKey,
  smsAccount: process.env.VOLC_SMS_ACCOUNT?.trim() || APP_CONFIG.providerDefaults.volcSms.smsAccount,
  sign: process.env.VOLC_SMS_SIGN?.trim() || APP_CONFIG.providerDefaults.volcSms.sign,
  templateId: process.env.VOLC_SMS_TEMPLATE_ID?.trim() || APP_CONFIG.providerDefaults.volcSms.templateId,
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
} finally {
  providerCredentials.close();
}
