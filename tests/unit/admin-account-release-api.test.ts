import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

describe("admin account release API isolation", () => {
  test("runs authenticated release requests against a temporary database", async () => {
    const dataDir = mkdtempSync(resolve(tmpdir(), "yaozuo-admin-release-api-runner-"));
    try {
      const child = Bun.spawn(["bun", "test", "./tests/integration/admin-account-release-api-isolated.test.ts"], {
        cwd: resolve(import.meta.dir, "../.."),
        env: { ...process.env, YAOZUO_DATA_DIR: dataDir },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 30_000);
});
