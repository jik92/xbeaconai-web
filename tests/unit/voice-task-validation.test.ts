import { describe, expect, test } from "bun:test";
import { validateVoiceTaskValues } from "../../server/voice/validate-voice-task";

const validClone = {
  operation: "clone",
  sample: "asset:asset-id:sample.wav",
  transcript: "这是一段准确的训练文本。",
  demoText: "你好，这是克隆音色试听。",
  authorized: "true",
  consentReference: "CONSENT-2026-001",
  consentScope: "仅训练和试听",
  consentExpiresAt: "2099-12-31",
};

const validPresetSynthesis = {
  operation: "synthesize",
  voiceSource: "preset",
  presetVoiceId: "zh_female_vv_uranus_bigtts",
  synthesisText: "你好，这是预置音色生成测试。",
  synthesisStyle: "自然",
  speechRate: "0",
};

describe("validateVoiceTaskValues", () => {
  test("accepts a complete authorized clone task", () => {
    expect(validateVoiceTaskValues(validClone)).toBeUndefined();
  });

  test("requires auditable authorization and rejects expired authorization", () => {
    expect(validateVoiceTaskValues({ ...validClone, consentReference: "" })).toBe("请填写可核验的授权记录编号");
    expect(validateVoiceTaskValues({ ...validClone, consentExpiresAt: "2000-01-01" })).toBe("授权记录已到期或日期无效");
  });

  test("accepts verified preset synthesis", () => {
    expect(validateVoiceTaskValues(validPresetSynthesis)).toBeUndefined();
    expect(validateVoiceTaskValues({ ...validPresetSynthesis, presetVoiceId: "unverified" })).toBe(
      "请选择当前已验证的预置音色",
    );
  });

  test("requires formal synthesis scope for cloned voices", () => {
    const values = {
      ...validPresetSynthesis,
      voiceSource: "cloned",
      synthesisSpeakerId: "S_test_voice",
      authorized: "true",
      consentReference: "CONSENT-2026-002",
      consentScope: "仅训练和试听",
      consentExpiresAt: "2099-12-31",
    };
    expect(validateVoiceTaskValues(values)).toBe("授权范围必须明确允许正式合成");
    expect(validateVoiceTaskValues({ ...values, consentScope: "允许正式合成" })).toBeUndefined();
  });

  test("validates speech rate and limits performance to preset styles", () => {
    expect(validateVoiceTaskValues({ ...validPresetSynthesis, speechRate: "101" })).toBe(
      "语速需为 -50 到 100 之间的整数",
    );
    expect(validateVoiceTaskValues({ ...validPresetSynthesis, synthesisStyle: "自定义" })).toBe(
      "请选择系统提供的配音风格",
    );
  });
});
