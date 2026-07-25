import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("Qwen voice sample preflight API", () => {
  test("publishes a protected preflight route and rechecks before queueing", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../server/app.ts")).text();

    expect(source).toContain('path: "/api/voice-clone/qwen/sample-preflight"');
    expect(source).toContain('operationId: "preflightQwenVoiceSample"');
    expect(source).toContain("preflightQwenVoiceSample(ownerUserId, assetId, accounts)");
    expect(source).toContain("preflightQwenVoiceSample(ownerUserId, sourceAssetId, accounts)");
    expect(source).toContain('code: "INVALID_QWEN_VOICE_SAMPLE"');
  });
});
