import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderCredentialStore } from "../../server/byok/credential-store";

const temporaryDirectories: string[] = [];
const masterKey = "unit-test-byok-master-key-with-more-than-32-characters";

function temporaryDatabase(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return join(directory, "yaozuo.sqlite");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("ProviderCredentialStore", () => {
  test("encrypts values at rest and only exposes a masked suffix", () => {
    const path = temporaryDatabase("byok-store-");
    const store = new ProviderCredentialStore(path, masterKey);
    const plaintext = "sk-sensitive-value-12345678";

    store.set("OPENAI_KEY", plaintext, crypto.randomUUID());
    expect(store.get("OPENAI_KEY")).toBe(plaintext);
    expect(store.listMasked().find((item) => item.name === "OPENAI_KEY")).toMatchObject({
      configured: true,
      maskedValue: "••••5678",
    });
    store.close();

    const database = new Database(path);
    const row = database
      .query("select ciphertext, nonce, auth_tag as authTag, last_four as lastFour from provider_credentials")
      .get() as { ciphertext: string; nonce: string; authTag: string; lastFour: string };
    expect(JSON.stringify(row)).not.toContain(plaintext);
    expect(row.ciphertext).not.toContain("sensitive");
    expect(row.lastFour).toBe("5678");
    database.close();
  });

  test("supports overwrite and deletion while rejecting the wrong master key", () => {
    const path = temporaryDatabase("byok-rotation-");
    const store = new ProviderCredentialStore(path, masterKey);
    store.set("MEDIAKIT_API_KEY", "first-key-value");
    store.set("MEDIAKIT_API_KEY", "rotated-key-value");
    expect(store.get("MEDIAKIT_API_KEY")).toBe("rotated-key-value");

    const wrongKeyStore = new ProviderCredentialStore(path, "different-master-key-with-more-than-32-characters");
    expect(() => wrongKeyStore.get("MEDIAKIT_API_KEY")).toThrow();
    wrongKeyStore.close();

    store.delete("MEDIAKIT_API_KEY");
    expect(store.get("MEDIAKIT_API_KEY")).toBeUndefined();
    store.close();
  });

  test("persists Doctor results and invalidates the affected Provider when credentials change", () => {
    const path = temporaryDatabase("byok-doctor-state-");
    const store = new ProviderCredentialStore(path, masterKey);
    store.set("OPENAI_KEY", "first-openai-key");
    store.saveChecks([
      {
        providerId: "aihubmix",
        provider: "AIHubMix",
        status: "available",
        message: "鉴权通过",
        latencyMs: 12,
        checkedAt: "2026-07-23T00:00:00.000Z",
      },
    ]);
    expect(store.isProviderVerified("aihubmix")).toBe(true);
    store.close();

    const reopened = new ProviderCredentialStore(path, masterKey);
    expect(reopened.listChecks()).toMatchObject([{ providerId: "aihubmix", status: "available" }]);
    reopened.set("OPENAI_KEY", "rotated-openai-key");
    expect(reopened.listChecks()).toEqual([]);
    expect(reopened.isProviderVerified("aihubmix")).toBe(false);
    reopened.close();
  });

  test("imports the legacy env keys without printing secret values", async () => {
    const path = temporaryDatabase("byok-import-");
    const directory = join(path, "..");
    const plaintext = "legacy-openai-secret-87654321";
    writeFileSync(join(directory, ".env.key"), `OPENAI_KEY=${plaintext}\n`, { mode: 0o600 });
    const child = Bun.spawn(["bun", join(import.meta.dir, "../../scripts/import-byok-env.ts")], {
      cwd: directory,
      env: {
        ...process.env,
        YAOZUO_DATA_DIR: directory,
        BYOK_ENCRYPTION_KEY: masterKey,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [output, errorOutput, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exitCode, errorOutput).toBe(0);
    expect(output).toContain("OPENAI_KEY: imported");
    expect(`${output}\n${errorOutput}`).not.toContain(plaintext);

    const store = new ProviderCredentialStore(path, masterKey);
    expect(store.get("OPENAI_KEY")).toBe(plaintext);
    store.close();
  });

  test("generates a missing master key once without logging it", async () => {
    const directory = mkdtempSync(join(tmpdir(), "byok-bootstrap-"));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, ".env"), "", { mode: 0o600 });
    writeFileSync(join(directory, ".env.key"), "OPENAI_KEY=bootstrap-provider-secret\n", { mode: 0o600 });
    const childEnvironment: Record<string, string | undefined> = {
      ...process.env,
      YAOZUO_DATA_DIR: join(directory, "data"),
    };
    delete childEnvironment.BYOK_ENCRYPTION_KEY;
    const run = () =>
      Bun.spawn(["bun", join(import.meta.dir, "../../scripts/import-byok-env.ts")], {
        cwd: directory,
        env: childEnvironment,
        stdout: "pipe",
        stderr: "pipe",
      });

    const first = run();
    const [firstOutput, firstError, firstExit] = await Promise.all([
      new Response(first.stdout).text(),
      new Response(first.stderr).text(),
      first.exited,
    ]);
    expect(firstExit, firstError).toBe(0);
    expect(firstOutput).toContain("generated and saved to .env");
    const firstEnv = readFileSync(join(directory, ".env"), "utf8");
    const generated = firstEnv.match(/^BYOK_ENCRYPTION_KEY=([a-f0-9]{64})$/m)?.[1];
    expect(generated).toHaveLength(64);
    expect(firstOutput).not.toContain(generated ?? "missing-generated-key");
    expect(statSync(join(directory, ".env")).mode & 0o777).toBe(0o600);

    const second = run();
    const [secondOutput, secondError, secondExit] = await Promise.all([
      new Response(second.stdout).text(),
      new Response(second.stderr).text(),
      second.exited,
    ]);
    expect(secondExit, secondError).toBe(0);
    expect(secondOutput).toContain("BYOK_ENCRYPTION_KEY: configured");
    expect(readFileSync(join(directory, ".env"), "utf8")).toBe(firstEnv);
  });

  test("does not replace an existing short master key", async () => {
    const directory = mkdtempSync(join(tmpdir(), "byok-short-key-"));
    temporaryDirectories.push(directory);
    const original = "BYOK_ENCRYPTION_KEY=too-short\n";
    writeFileSync(join(directory, ".env"), original, { mode: 0o600 });
    const childEnvironment: Record<string, string | undefined> = {
      ...process.env,
      YAOZUO_DATA_DIR: join(directory, "data"),
    };
    delete childEnvironment.BYOK_ENCRYPTION_KEY;
    const child = Bun.spawn(["bun", join(import.meta.dir, "../../scripts/import-byok-env.ts")], {
      cwd: directory,
      env: childEnvironment,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [errorOutput, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    expect(exitCode).not.toBe(0);
    expect(errorOutput).toContain("已存在但少于 32 字符");
    expect(readFileSync(join(directory, ".env"), "utf8")).toBe(original);
  });

  test("migrates provider keys out of .env without logging their values", async () => {
    const directory = mkdtempSync(join(tmpdir(), "byok-env-migration-"));
    temporaryDirectories.push(directory);
    const plaintext = "provider-secret-for-migration";
    writeFileSync(
      join(directory, ".env"),
      `JWT_SECRET=system-value\nOPENAI_KEY=${plaintext}\nREDIS_URL=redis://127.0.0.1:6379\n`,
      { mode: 0o600 },
    );
    const child = Bun.spawn(["bun", join(import.meta.dir, "../../scripts/migrate-env-key.ts")], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [output, errorOutput, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exitCode, errorOutput).toBe(0);
    expect(`${output}\n${errorOutput}`).not.toContain(plaintext);
    expect(readFileSync(join(directory, ".env"), "utf8")).toBe(
      "JWT_SECRET=system-value\nREDIS_URL=redis://127.0.0.1:6379\n",
    );
    expect(readFileSync(join(directory, ".env.key"), "utf8")).toContain(`OPENAI_KEY=${plaintext}`);
    expect(statSync(join(directory, ".env.key")).mode & 0o777).toBe(0o600);
  });
});
