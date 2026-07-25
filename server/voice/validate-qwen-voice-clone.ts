import { isQwenVoiceDialect, isQwenVoiceSpeed, isQwenVoiceStyle } from "../../shared/voice/qwen-voice";

export function validateQwenVoiceCloneValues(values: Record<string, string>) {
  if (values.voiceProvider !== "qwen" || values.operation !== "clone") return "Qwen 音色任务类型无效";
  if (!values.sample?.startsWith("asset:")) return "请选择声音复刻录音";
  const demoText = values.demoText?.trim() ?? "";
  if (demoText.length < 4 || demoText.length > 300) return "试听文本需为 4–300 字";
  if (!isQwenVoiceDialect(values.dialect ?? "")) return "请选择官方支持的合成方言";
  if (!isQwenVoiceStyle(values.style ?? "")) return "请选择系统提供的配音风格";
  if (!isQwenVoiceSpeed(values.speechSpeed ?? "")) return "请选择系统提供的音色速度";
  if (!["true", "false"].includes(values.autoSave ?? "")) return "自动保存参数无效";
  return undefined;
}
