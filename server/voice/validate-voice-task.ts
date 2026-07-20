import { isVoicePresetId } from "../../shared/voice/preset-voices";
import { isVoicePresetStyle } from "../../shared/voice/preset-styles";

function invalidConsentExpiry(value: string | undefined) {
  if (!value) return false;
  const timestamp = Date.parse(`${value}T23:59:59.999`);
  return !Number.isFinite(timestamp) || timestamp < Date.now();
}

export function validateVoiceTaskValues(values: Record<string, string>): string | undefined {
  if (values.operation === "synthesize") {
    const voiceSource = values.voiceSource;
    const text = values.synthesisText?.trim() ?? "";
    const clonedSpeakerId = values.synthesisSpeakerId?.trim() ?? "";
    const rate = Number(values.speechRate ?? 0);
    if (!new Set(["preset", "cloned"]).has(voiceSource)) return "请选择预置音色或克隆音色";
    if (voiceSource === "preset" && !isVoicePresetId(values.presetVoiceId ?? "")) return "请选择当前已验证的预置音色";
    if (voiceSource === "cloned" && !clonedSpeakerId) return "请输入克隆音色 ID";
    if (voiceSource === "cloned" && !/^[A-Za-z0-9_-]{3,256}$/.test(clonedSpeakerId)) return "克隆音色 ID 格式不正确";
    if (voiceSource === "cloned" && values.authorized !== "true") return "请确认拥有该克隆音色的合成授权";
    if (voiceSource === "cloned" && (values.consentReference?.trim().length ?? 0) < 3)
      return "请填写可核验的授权记录编号";
    if (voiceSource === "cloned" && !["允许正式合成", "允许商业发布"].includes(values.consentScope ?? ""))
      return "授权范围必须明确允许正式合成";
    if (voiceSource === "cloned" && invalidConsentExpiry(values.consentExpiresAt)) return "授权记录已到期或日期无效";
    if (!text || text.length > 1_000) return "合成文本需为 1–1000 字";
    if (!Number.isInteger(rate) || rate < -50 || rate > 100) return "语速需为 -50 到 100 之间的整数";
    if (!isVoicePresetStyle(values.synthesisStyle ?? "")) return "请选择系统提供的配音风格";
    return undefined;
  }

  const demoText = values.demoText?.trim() ?? "";
  const transcript = values.transcript?.trim() ?? "";
  if (values.authorized !== "true") return "请先确认已获得录音人的明确授权";
  if ((values.consentReference?.trim().length ?? 0) < 3) return "请填写可核验的授权记录编号";
  if (invalidConsentExpiry(values.consentExpiresAt)) return "授权记录已到期或日期无效";
  if (!values.sample?.startsWith("asset:")) return "请选择训练录音";
  if (!transcript) return "请输入训练录音对应文本";
  if (demoText.length < 4 || demoText.length > 300) return "试听文本需为 4–300 字";
  return undefined;
}
