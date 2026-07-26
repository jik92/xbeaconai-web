import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../env";

export interface EncryptedToken {
  ciphertext: string;
  nonce: string;
  authTag: string;
}

function tokenKey() {
  if (env.byokEncryptionKey.length < 32) throw new Error("BYOK_ENCRYPTION_KEY 未配置");
  return createHash("sha256").update(`qianchuan-oauth:${env.byokEncryptionKey}`, "utf8").digest();
}

export function encryptQianchuanToken(value: string): EncryptedToken {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptQianchuanToken(value: EncryptedToken) {
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(value.nonce, "base64"));
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
