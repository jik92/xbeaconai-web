import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

describe("AI creation API isolation", () => {
  test("runs the dedicated API suite with an isolated database", async () => {
    const dataDir = mkdtempSync(resolve(tmpdir(), "yaozuo-ai-generate-api-test-"));
    try {
      const child = Bun.spawn(["bun", "test", "./tests/integration/ai-generate-api-isolated.test.ts"], {
        cwd: resolve(import.meta.dir, "../.."),
        env: {
          ...process.env,
          YAOZUO_DATA_DIR: dataDir,
          MOCK_GENERATE_VIDEO_API: "true",
          BYOK_ENCRYPTION_KEY: "ai-generate-test-encryption-key-32-characters",
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
