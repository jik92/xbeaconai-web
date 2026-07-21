import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnvKey, removeProviderEnvironment, serializeEnvKey } from "../server/byok/env-key";

const envPath = resolve(".env");
const keyPath = resolve(".env.key");
if (!existsSync(envPath)) throw new Error("找不到 .env");
const envContents = readFileSync(envPath, "utf8");
const legacy = parseEnvKey(envContents);
const existing = existsSync(keyPath) ? parseEnvKey(readFileSync(keyPath, "utf8")) : undefined;
const merged = { ...legacy.values, ...existing?.values };
const keyTemporaryPath = `${keyPath}.${process.pid}.tmp`;
const envTemporaryPath = `${envPath}.${process.pid}.tmp`;

writeFileSync(keyTemporaryPath, serializeEnvKey(merged), { encoding: "utf8", mode: 0o600 });
writeFileSync(envTemporaryPath, removeProviderEnvironment(envContents), { encoding: "utf8", mode: 0o600 });
renameSync(keyTemporaryPath, keyPath);
renameSync(envTemporaryPath, envPath);
chmodSync(keyPath, 0o600);
chmodSync(envPath, 0o600);
console.log(`Migrated ${Object.keys(legacy.values).length} Provider Key field(s) from .env to .env.key`);
