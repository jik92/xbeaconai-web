import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desc, eq } from "drizzle-orm";
import { AccountError, AccountStore } from "../../server/accounts/account-store";
import type { SmsMessage, SmsSender } from "../../server/accounts/sms-sender";
import { smsVerificationCodes } from "../../server/db/schema";

const databases: string[] = [];
afterEach(() => {
  for (const path of databases.splice(0)) {
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});

function fixture(code = "246810") {
  const path = join(tmpdir(), `phone-auth-${crypto.randomUUID()}.sqlite`);
  databases.push(path);
  const messages: SmsMessage[] = [];
  const sender: SmsSender = { send: async (message) => void messages.push(message) };
  const store = new AccountStore(path, { smsSender: sender, generateSmsCode: () => code });
  return { store, messages };
}

describe("phone authentication", () => {
  test("stores only a code hash and registers once with phone and password", async () => {
    const { store, messages } = fixture();
    const sent = await store.sendRegistrationCode("138 0000 0021");
    expect(sent.retryAfterSeconds).toBe(60);
    expect(messages).toEqual([expect.objectContaining({ phone: "13800000021", code: "246810", purpose: "register" })]);
    const stored = store.db.select().from(smsVerificationCodes).orderBy(desc(smsVerificationCodes.createdAt)).get();
    expect(stored?.codeHash).not.toContain("246810");

    const registration = await store.register({
      phone: "13800000021",
      verificationCode: "246810",
      password: "Password123",
      displayName: "手机号用户",
    });
    expect(registration.user.phone).toBe("13800000021");
    expect((await store.verifyCredentials("13800000021", "Password123")).id).toBe(registration.user.id);
    await expect(
      store.register({
        phone: "13800000021",
        verificationCode: "246810",
        password: "Password123",
        displayName: "重复用户",
      }),
    ).rejects.toMatchObject({ code: "SMS_CODE_INVALID" });
    store.close();
  });

  test("enforces cooldown, expiry and failed-attempt invalidation", async () => {
    const { store } = fixture();
    await store.sendRegistrationCode("13800000022");
    await expect(store.sendRegistrationCode("13800000022")).rejects.toMatchObject({ code: "SMS_CODE_COOLDOWN" });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(
        store.register({
          phone: "13800000022",
          verificationCode: "000000",
          password: "Password123",
          displayName: "错误验证码",
        }),
      ).rejects.toMatchObject({ code: attempt === 5 ? "SMS_CODE_ATTEMPTS_EXCEEDED" : "SMS_CODE_INVALID" });
    }

    const expired = fixture("135790");
    await expired.store.sendRegistrationCode("13800000023");
    expired.store.db
      .update(smsVerificationCodes)
      .set({ expiresAt: new Date(Date.now() - 1_000).toISOString() })
      .where(eq(smsVerificationCodes.phone, "13800000023"))
      .run();
    await expect(
      expired.store.register({
        phone: "13800000023",
        verificationCode: "135790",
        password: "Password123",
        displayName: "过期验证码",
      }),
    ).rejects.toMatchObject({ code: "SMS_CODE_EXPIRED" });
    expired.store.close();
    store.close();
  });

  test("rejects invalid phone numbers without sending", async () => {
    const { store, messages } = fixture();
    await expect(store.sendRegistrationCode("12345")).rejects.toBeInstanceOf(AccountError);
    expect(messages).toHaveLength(0);
    store.close();
  });

  test("removes the pending code when the SMS sender fails", async () => {
    const path = join(tmpdir(), `phone-auth-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const store = new AccountStore(path, {
      smsSender: { send: async () => Promise.reject(new Error("SMS provider unavailable")) },
      generateSmsCode: () => "246810",
    });
    await expect(store.sendRegistrationCode("13800000024")).rejects.toThrow("SMS provider unavailable");
    expect(store.db.select().from(smsVerificationCodes).all()).toHaveLength(0);
    store.close();
  });
});
