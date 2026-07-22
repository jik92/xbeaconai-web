import { AccountStore } from "../../server/accounts/account-store";
import type { SmsSender } from "../../server/accounts/sms-sender";

export const TEST_SMS_CODE = "246810";

const silentSmsSender: SmsSender = { send: async () => {} };

export function createTestAccountStore(path: string) {
  return new AccountStore(path, { smsSender: silentSmsSender, generateSmsCode: () => TEST_SMS_CODE });
}

export async function registerTestAccount(
  store: AccountStore,
  input: { phone: string; password: string; displayName: string },
) {
  await store.sendRegistrationCode(input.phone);
  const challenge = await store.register({ phone: input.phone, verificationCode: TEST_SMS_CODE });
  await store.setupPassword(challenge.setupToken, input.password);
  const user = store.updateProfile(challenge.userId, {
    displayName: input.displayName,
  });
  return { ...challenge, user };
}
