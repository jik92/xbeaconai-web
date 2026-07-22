import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { type AppDatabase, openDatabase } from "../db/database";
import { providerCredentialChecks as checkTable, providerCredentials as credentialTable } from "../db/schema";
import { env } from "../env";
import {
  type ProviderCredentialName,
  type ProviderId,
  providerCredentialCatalog,
  providerCredentialNames,
  providerIdForCredential,
  providerIds,
} from "./credential-definitions";

export {
  type ProviderCredentialName,
  type ProviderId,
  providerCredentialCatalog,
  providerCredentialNames,
  providerIds,
};

export type CredentialCheckStatus = "available" | "missing" | "invalid" | "timeout";

export interface StoredCredentialCheck {
  providerId: ProviderId;
  provider: string;
  status: CredentialCheckStatus;
  message: string;
  latencyMs: number;
  checkedAt: string;
}

export interface MaskedProviderCredential {
  name: ProviderCredentialName;
  providerId: ProviderId;
  provider: string;
  label: string;
  secret: boolean;
  configured: boolean;
  maskedValue?: string;
  updatedAt?: string;
}

function encryptionKey(value: string) {
  if (value.length < 32) throw new Error("BYOK_ENCRYPTION_KEY 必须至少 32 字符");
  return createHash("sha256").update(value, "utf8").digest();
}

function encrypt(value: string, masterKey: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(masterKey), nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

function decrypt(row: { ciphertext: string; nonce: string; authTag: string }, masterKey: string) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(masterKey), Buffer.from(row.nonce, "base64"));
  decipher.setAuthTag(Buffer.from(row.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(row.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

export class ProviderCredentialStore {
  readonly db: AppDatabase;
  private readonly client: ReturnType<typeof openDatabase>["client"];

  constructor(
    path = env.databasePath,
    private readonly masterKey = env.byokEncryptionKey,
  ) {
    const connection = openDatabase(path);
    this.client = connection.client;
    this.db = connection.db;
  }

  get available() {
    return this.masterKey.length >= 32;
  }

  close() {
    this.client.close();
  }

  get(name: ProviderCredentialName) {
    if (!this.available) return undefined;
    const row = this.db.select().from(credentialTable).where(eq(credentialTable.name, name)).get();
    return row ? decrypt(row, this.masterKey) : undefined;
  }

  listMasked(): MaskedProviderCredential[] {
    const rows = new Map(
      this.db
        .select()
        .from(credentialTable)
        .all()
        .map((row) => [row.name, row]),
    );
    return providerCredentialCatalog.map((item) => {
      const row = rows.get(item.name);
      return {
        ...item,
        configured: Boolean(row),
        maskedValue: row ? `••••${row.lastFour}` : undefined,
        updatedAt: row?.updatedAt,
      };
    });
  }

  listChecks(): StoredCredentialCheck[] {
    const rows = new Map(
      this.db
        .select()
        .from(checkTable)
        .all()
        .map((row) => [row.providerId, row]),
    );
    return providerIds.flatMap((providerId) => {
      const row = rows.get(providerId);
      return row ? [{ ...row, providerId: providerId as ProviderId }] : [];
    });
  }

  saveChecks(checks: StoredCredentialCheck[]) {
    this.db.transaction((tx) => {
      for (const check of checks)
        tx.insert(checkTable)
          .values(check)
          .onConflictDoUpdate({
            target: checkTable.providerId,
            set: {
              provider: check.provider,
              status: check.status,
              message: check.message,
              latencyMs: check.latencyMs,
              checkedAt: check.checkedAt,
            },
          })
          .run();
    });
  }

  isProviderVerified(providerId: ProviderId) {
    if (!this.available) return false;
    return this.db.select().from(checkTable).where(eq(checkTable.providerId, providerId)).get()?.status === "available";
  }

  private invalidateChecks(tx: AppDatabase, names: ProviderCredentialName[]) {
    const affected = [...new Set(names.map(providerIdForCredential))];
    if (affected.length) tx.delete(checkTable).where(inArray(checkTable.providerId, affected)).run();
  }

  set(name: ProviderCredentialName, value: string, updatedByUserId?: string) {
    this.setMany({ [name]: value }, updatedByUserId);
  }

  setMany(values: Partial<Record<ProviderCredentialName, string>>, updatedByUserId?: string) {
    if (!this.available) throw new Error("BYOK_ENCRYPTION_KEY 未配置");
    const entries = providerCredentialNames
      .map((name) => [name, values[name]?.trim()] as const)
      .filter((entry): entry is readonly [ProviderCredentialName, string] => Boolean(entry[1]));
    if (!entries.length) return [];
    const timestamp = new Date().toISOString();
    this.db.transaction((tx) => {
      for (const [name, normalized] of entries) {
        const encrypted = encrypt(normalized, this.masterKey);
        tx.insert(credentialTable)
          .values({
            name,
            ...encrypted,
            lastFour: normalized.slice(-4),
            updatedByUserId,
            updatedAt: timestamp,
          })
          .onConflictDoUpdate({
            target: credentialTable.name,
            set: { ...encrypted, lastFour: normalized.slice(-4), updatedByUserId, updatedAt: timestamp },
          })
          .run();
      }
      this.invalidateChecks(
        tx as AppDatabase,
        entries.map(([name]) => name),
      );
    });
    return entries.map(([name]) => name);
  }

  delete(name: ProviderCredentialName) {
    this.db.transaction((tx) => {
      tx.delete(credentialTable).where(eq(credentialTable.name, name)).run();
      this.invalidateChecks(tx as AppDatabase, [name]);
    });
  }
}

export const providerCredentials = new ProviderCredentialStore();
