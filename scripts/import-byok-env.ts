import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnvKey } from "../server/byok/env-key";

function initializeMasterKey() {
  const configured = process.env.BYOK_ENCRYPTION_KEY?.trim() ?? "";
  if (configured) {
    if (configured.length < 32) throw new Error("BYOK_ENCRYPTION_KEY 已存在但少于 32 字符，请手动修正后重试");
    console.log("BYOK_ENCRYPTION_KEY: configured");
    return configured;
  }

  const envPath = resolve(".env");
  const generated = randomBytes(32).toString("hex");
  const contents = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const separator = contents && !contents.endsWith("\n") ? "\n" : "";
  appendFileSync(envPath, `${separator}BYOK_ENCRYPTION_KEY=${generated}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(envPath, 0o600);
  process.env.BYOK_ENCRYPTION_KEY = generated;
  console.log("BYOK_ENCRYPTION_KEY: generated and saved to .env");
  return generated;
}

const masterKey = initializeMasterKey();
const { ProviderCredentialStore, providerCredentialNames } = await import("../server/byok/credential-store");
const { env } = await import("../server/env");
const keyPath = resolve(process.argv[2] ?? ".env.key");
if (!existsSync(keyPath)) throw new Error(`找不到 ${keyPath}，请先复制 .env.key.example 并填写 Provider Key`);
const parsed = parseEnvKey(readFileSync(keyPath, "utf8"));
const store = new ProviderCredentialStore(env.databasePath, masterKey);
try {
  const imported = store.setMany(parsed.values);
  for (const name of providerCredentialNames) {
    console.log(`${name}: ${imported.includes(name) ? "imported" : "skipped"}`);
  }
  if (parsed.ignored.length) console.log(`Ignored unsupported fields: ${parsed.ignored.join(", ")}`);
  console.log(`BYOK import complete: ${imported.length} credential(s)`);
  console.log("Restart Server and Worker to load the BYOK encryption key.");
} finally {
  store.close();
}
