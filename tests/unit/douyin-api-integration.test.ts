import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

describe("douyin API integration isolation", () => {
  test("runs the API suite in a subprocess with a temporary database", async () => {
    const testDataDir = mkdtempSync(resolve(tmpdir(), "yaozuo-douyin-api-test-"));
    try {
      const child = Bun.spawn(["bun", "test", "./tests/integration/douyin-api-isolated.test.ts"], {
        cwd: resolve(import.meta.dir, "../.."),
        env: { ...process.env, YAOZUO_DATA_DIR: testDataDir },
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
      rmSync(testDataDir, { recursive: true, force: true });
    }
  }, 30_000);
});
