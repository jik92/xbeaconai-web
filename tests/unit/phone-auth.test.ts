import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desc, eq } from "drizzle-orm";
import { AccountError, AccountStore } from "../../server/accounts/account-store";
import type { SmsMessage, SmsSender } from "../../server/accounts/sms-sender";
import { passwordSetupTokens, smsVerificationCodes, users } from "../../server/db/schema";

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

async function registerPending(store: AccountStore, phone: string, code = "246810") {
  await store.sendRegistrationCode(phone);
  return store.register({ phone, verificationCode: code });
}

describe("two-step phone authentication", () => {
  test("registers a pending account before password setup and consumes the setup token once", async () => {
    const { store, messages } = fixture();
    const sent = await store.sendRegistrationCode("138 0000 0021");
    expect(sent.retryAfterSeconds).toBe(60);
    expect(sent.verificationCode).toBe("246810");
    expect(messages).toEqual([expect.objectContaining({ phone: "13800000021", code: "246810", purpose: "register" })]);
    const storedCode = store.db.select().from(smsVerificationCodes).orderBy(desc(smsVerificationCodes.createdAt)).get();
    expect(storedCode?.codeHash).not.toContain("246810");

    const challenge = await store.register({ phone: "13800000021", verificationCode: "246810" });
    const pending = store.db.select().from(users).where(eq(users.phone, "13800000021")).get();
    expect(pending).toMatchObject({ status: "pending_password", displayName: "用户0021" });
    expect(pending?.passwordHash.length).toBeGreaterThan(32);
    await expect(store.verifyCredentials("13800000021", "Password123")).rejects.toMatchObject({
      code: "PASSWORD_SETUP_REQUIRED",
    });
    const storedToken = store.db.select().from(passwordSetupTokens).get();
    expect(storedToken?.tokenHash).not.toBe(challenge.setupToken);

    const user = await store.setupPassword(challenge.setupToken, "Password123");
    expect(user.phone).toBe("13800000021");
    expect((await store.verifyCredentials("13800000021", "Password123")).id).toBe(user.id);
    await expect(store.setupPassword(challenge.setupToken, "Another123")).rejects.toMatchObject({
      code: "PASSWORD_SETUP_TOKEN_INVALID",
    });
    store.close();
  });

  test("supports disabling verification-code exposure for production", async () => {
    const path = join(tmpdir(), `phone-auth-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const store = new AccountStore(path, {
      smsSender: { send: async () => {} },
      generateSmsCode: () => "246810",
      exposeSmsCode: false,
    });

    expect((await store.sendRegistrationCode("13800000028")).verificationCode).toBeUndefined();
    store.close();
  });

  test("updates only the profile name and keeps legacy avatar data internal", async () => {
    const { store } = fixture();
    const challenge = await registerPending(store, "13800000029");

    const user = store.updateProfile(challenge.userId, { displayName: "  新名字  " });
    const stored = store.db.select().from(users).where(eq(users.id, challenge.userId)).get();

    expect(user.displayName).toBe("新名字");
    expect("avatarText" in user).toBe(false);
    expect(stored?.avatarText).toBe("29");
    store.close();
  });

  test("enforces code cooldown, expiry and failed-attempt invalidation", async () => {
    const { store } = fixture();
    await store.sendRegistrationCode("13800000022");
    await expect(store.sendRegistrationCode("13800000022")).rejects.toMatchObject({ code: "SMS_CODE_COOLDOWN" });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(store.register({ phone: "13800000022", verificationCode: "000000" })).rejects.toMatchObject({
        code: attempt === 5 ? "SMS_CODE_ATTEMPTS_EXCEEDED" : "SMS_CODE_INVALID",
      });
    }

    const expired = fixture("135790");
    await expired.store.sendRegistrationCode("13800000023");
    expired.store.db
      .update(smsVerificationCodes)
      .set({ expiresAt: new Date(Date.now() - 1_000).toISOString() })
      .where(eq(smsVerificationCodes.phone, "13800000023"))
      .run();
    await expect(expired.store.register({ phone: "13800000023", verificationCode: "135790" })).rejects.toMatchObject({
      code: "SMS_CODE_EXPIRED",
    });
    expired.store.close();
    store.close();
  });

  test("recovers a pending account through forgot password", async () => {
    const { store, messages } = fixture();
    await registerPending(store, "13800000024");
    await store.sendPasswordResetCode("13800000024");
    expect(messages.at(-1)).toMatchObject({ purpose: "reset_password" });
    const reset = await store.verifyPasswordReset({ phone: "13800000024", verificationCode: "246810" });
    await store.setupPassword(reset.setupToken, "Recovered123");
    expect((await store.verifyCredentials("13800000024", "Recovered123")).phone).toBe("13800000024");
    store.close();
  });

  test("resets an active password and invalidates old sessions", async () => {
    const { store } = fixture();
    const registration = await registerPending(store, "13800000025");
    const user = await store.setupPassword(registration.setupToken, "Original123");
    const oldSession = store.createSession(user.id, new Date(Date.now() + 60_000).toISOString());

    await store.sendPasswordResetCode("13800000025");
    const reset = await store.verifyPasswordReset({ phone: "13800000025", verificationCode: "246810" });
    await store.setupPassword(reset.setupToken, "Replacement123");

    expect(store.validateSession(user.id, oldSession.id, oldSession.jti, oldSession.passwordVersion)).toBeUndefined();
    await expect(store.verifyCredentials("13800000025", "Original123")).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    expect((await store.verifyCredentials("13800000025", "Replacement123")).id).toBe(user.id);
    store.close();
  });

  test("rejects expired setup tokens and keeps SMS purposes isolated", async () => {
    const { store } = fixture();
    const challenge = await registerPending(store, "13800000026");
    const storedToken = store.db.select().from(passwordSetupTokens).get();
    if (!storedToken) throw new Error("PASSWORD_SETUP_TOKEN_NOT_STORED");
    store.db
      .update(passwordSetupTokens)
      .set({ expiresAt: new Date(Date.now() - 1_000).toISOString() })
      .where(eq(passwordSetupTokens.tokenHash, storedToken.tokenHash))
      .run();
    await expect(store.setupPassword(challenge.setupToken, "Password123")).rejects.toMatchObject({
      code: "PASSWORD_SETUP_TOKEN_EXPIRED",
    });
    await expect(store.sendRegistrationCode("13800000026")).rejects.toMatchObject({ code: "PHONE_ALREADY_REGISTERED" });
    await store.sendPasswordResetCode("13800000026");
    await expect(store.register({ phone: "13800000026", verificationCode: "246810" })).rejects.toMatchObject({
      code: "SMS_CODE_INVALID",
    });
    store.close();
  });

  test("rejects invalid phones and removes codes when the SMS sender fails", async () => {
    const { store, messages } = fixture();
    await expect(store.sendRegistrationCode("12345")).rejects.toBeInstanceOf(AccountError);
    expect(messages).toHaveLength(0);
    store.close();

    const path = join(tmpdir(), `phone-auth-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const failingStore = new AccountStore(path, {
      smsSender: { send: async () => Promise.reject(new Error("SMS provider unavailable")) },
      generateSmsCode: () => "246810",
    });
    await expect(failingStore.sendRegistrationCode("13800000027")).rejects.toThrow("SMS provider unavailable");
    expect(failingStore.db.select().from(smsVerificationCodes).all()).toHaveLength(0);
    failingStore.close();
  });
});
