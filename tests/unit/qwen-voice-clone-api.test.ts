import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("Qwen voice clone API routing", () => {
  test("accepts only Qwen for newly submitted voice-clone jobs", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../server/app.ts")).text();

    expect(source).toContain('body.values.voiceProvider === "qwen"');
    expect(source).toContain('moduleId === "voice-clone" && body.values.voiceProvider !== "qwen"');
    expect(source).toContain('code: "QWEN_VOICE_CLONE_REQUIRED"');
    expect(source).toContain('message: "新建音色克隆任务仅支持 Qwen"');
    expect(source).toContain('providerFeatureAvailability(["qwen-audio", "tos"])');
    expect(source).toContain("validateQwenVoiceCloneValues(jobValues)");
    expect(source).toContain(`jobValues.auditReference = \`authenticated-submission:\${ownerUserId}:\${`);
    expect(source).toContain("jobValues.submittedByUserId = ownerUserId");
    expect(source).not.toContain('providerFeatureAvailability(["volc-speech"])');
    expect(source).not.toContain('jobValues.presetVoiceId = "zh_female_vv_uranus_bigtts"');
  });
});
