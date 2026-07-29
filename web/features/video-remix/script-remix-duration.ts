const narrationPattern = /(?:原文口播(?:与字幕)?|口播文案)\s*[：:]\s*([^｜|\n]+)/g;

function narrationCharacterCount(prompt: string) {
  const narration = [...prompt.matchAll(narrationPattern)].map((match) => match[1] ?? "").join("");
  return [...narration.replace(/[^\p{L}\p{N}]/gu, "")].length;
}

export function suggestScriptRemixDuration(prompt: string, supportedDurations: number[], fallbackDuration = 15) {
  const supported = [...new Set(supportedDurations)]
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!supported.length) return fallbackDuration;
  const characterCount = narrationCharacterCount(prompt);
  if (!characterCount)
    return supported.includes(fallbackDuration) ? fallbackDuration : supported.at(-1) || fallbackDuration;
  const estimatedSeconds = Math.max(supported[0] || 1, Math.ceil(characterCount / 3.5));
  return supported.find((candidate) => candidate >= estimatedSeconds) ?? supported.at(-1) ?? fallbackDuration;
}
