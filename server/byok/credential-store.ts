import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { type AppDatabase, openDatabase } from "../db/database";
import { providerCredentials as credentialTable } from "../db/schema";
import { env } from "../env";
import {
  type ProviderCredentialName,
  providerCredentialCatalog,
  providerCredentialNames,
} from "./credential-definitions";

export { type ProviderCredentialName, providerCredentialCatalog, providerCredentialNames };

export interface MaskedProviderCredential {
  name: ProviderCredentialName;
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
    });
    return entries.map(([name]) => name);
  }

  delete(name: ProviderCredentialName) {
    this.db.delete(credentialTable).where(eq(credentialTable.name, name)).run();
  }
}

export const providerCredentials = new ProviderCredentialStore();
