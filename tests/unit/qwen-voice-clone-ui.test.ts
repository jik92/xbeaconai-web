import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("Qwen voice clone UI", () => {
  test("exposes Qwen as the only new voice-clone task flow", async () => {
    const page = await Bun.file(resolve(import.meta.dir, "../../web/components/domain/module-page.tsx")).text();
    const modal = await Bun.file(
      resolve(import.meta.dir, "../../web/features/voice-clone/qwen-voice-clone-modal.tsx"),
    ).text();

    expect(page).toContain("<QwenVoiceCloneModal");
    expect(page).toContain('actionLabel={config.id === "voice-clone" ? "新建音色人物" : newTaskLabel}');
    expect(page).toContain(
      'onAction={() => (config.id === "voice-clone" ? setQwenCreatorOpen(true) : setCreatorOpen(true))}',
    );
    expect(page).toContain('open={config.id !== "voice-clone" && creatorOpen}');
    expect(page).not.toContain("secondaryAction=");
    expect(modal).toContain('voiceProvider: "qwen"');
    expect(modal).toContain('title="新建音色人物"');
    expect(modal).toContain("官方支持的合成方言");
    expect(modal).toContain("音频转换文本");
    expect(modal).toContain("音色速度");
    expect(modal).toContain("const [autoSave, setAutoSave] = useState(true)");
    expect(modal).toContain("autoSave: String(autoSave)");
    expect(modal).toContain("checkQwenVoiceSample");
    expect(modal).toContain("sampleChecking");
    expect(modal).toContain("录音校验通过");
    expect(modal).toContain("sampleChecking || !samplePreflight");
    expect(modal).not.toContain("人物名称");
    expect(modal).not.toContain("授权记录编号");
    expect(modal).not.toContain("授权到期日");
    expect(modal).not.toContain("已获得录音人的明确授权");
    expect(page).not.toContain('config.id === "voice-clone" ? generatedTitle');
  });
});
