export interface RemixShotReferenceBinding {
  label: string;
}

function hasPromptMention(prompt: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_-])@${escaped}(?![A-Za-z0-9_-])`).test(prompt);
}

/**
 * Makes the textual @ token and the submitted reference bindings one contract.
 * The worker intentionally receives only the bindings which pass this check.
 */
export function validateRemixShotReferenceBindings(prompt: string, bindings: RemixShotReferenceBinding[]) {
  const labels = bindings.map((binding) => binding.label);
  if (new Set(labels).size !== labels.length) return "参考素材标签不能重复";

  const mentionedLabels = prompt.match(/@Image[1-9]\d*/g)?.map((token) => token.slice(1)) ?? [];
  const unresolved = mentionedLabels.find((label) => !labels.includes(label));
  if (unresolved) return `@${unresolved} 未绑定到参考素材`;

  const missing = labels.find((label) => !hasPromptMention(prompt, label));
  return missing ? `提示词缺少 @${missing} 引用` : undefined;
}
