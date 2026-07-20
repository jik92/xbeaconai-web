import type { AdScriptCompliance, AdScriptInput } from "./types";
import { targetLengthBounds } from "./types";

const riskyRules: ReadonlyArray<{ id: string; pattern: RegExp; message: string; suggestion: string }> = [
  {
    id: "absolute-claim",
    pattern: /最(?:好|佳|强|高|低|便宜|先进)|第一|顶级|唯一|百分之百|100%|绝对|永久|万能/g,
    message: "包含无法客观证明的绝对化表达",
    suggestion: "改为可验证、有限定条件的客观描述",
  },
  {
    id: "guaranteed-result",
    pattern: /保证|包治|根治|无效退款|稳赚|必赚|立刻见效|药到病除/g,
    message: "包含保证效果或收益的承诺",
    suggestion: "删除保证性承诺，并说明效果可能因人而异",
  },
  {
    id: "unverifiable-benefit",
    pattern: /零风险|无副作用|完全无害|国家级|世界级/g,
    message: "包含高风险或需要权威依据的表述",
    suggestion: "仅保留具备材料证明的事实，并补充必要限定",
  },
];

function characterCount(script: string) {
  return [...script.replace(/\s/g, "")].length;
}

export function checkAdScriptCompliance(script: string, input: AdScriptInput): AdScriptCompliance {
  const findings: AdScriptCompliance["findings"] = [];
  for (const rule of riskyRules) {
    for (const match of script.matchAll(rule.pattern)) {
      const start = match.index ?? 0;
      findings.push({
        ruleId: rule.id,
        severity: "blocking",
        source: "local",
        excerpt: match[0],
        start,
        end: start + match[0].length,
        message: rule.message,
        suggestion: rule.suggestion,
      });
    }
  }

  const [minimum, maximum] = targetLengthBounds(input.targetLength);
  const length = characterCount(script);
  if (length < minimum || length > maximum)
    findings.push({
      ruleId: "length-range",
      severity: "blocking",
      source: "local",
      excerpt: `${length} 字`,
      message: `脚本字数应为 ${minimum}-${maximum} 字，当前为 ${length} 字`,
      suggestion: length < minimum ? "补充具体利益点、场景或行动指引" : "删除重复表达并压缩到目标字数",
    });

  if (!/(立即|现在|点击|下单|购买|预约|到店|领取|下载|关注|咨询|进房|直播间|试试|行动)/.test(script))
    findings.push({
      ruleId: "missing-cta",
      severity: "blocking",
      source: "local",
      excerpt: "",
      message: "脚本缺少明确的行动召唤",
      suggestion: "在结尾加入与营销场景一致、不过度承诺的行动指引",
    });

  return { passed: !findings.some((finding) => finding.severity === "blocking"), findings };
}
