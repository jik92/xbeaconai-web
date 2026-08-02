import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

describe("script remix next Worker isolation", () => {
  test("runs document analysis and storyboard generation against isolated storage", async () => {
    const dataDir = mkdtempSync(resolve(tmpdir(), "script-remix-next-worker-runner-"));
    try {
      const child = Bun.spawn(["bun", "test", "./tests/integration/script-remix-next-worker-isolated.test.ts"], {
        cwd: resolve(import.meta.dir, "../.."),
        env: {
          ...process.env,
          YAOZUO_DATA_DIR: dataDir,
          BYOK_ENCRYPTION_KEY: "script-remix-next-worker-runner-key",
        },
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
