export interface RemixPromptSection {
  title: string;
  rows: string[];
}

const sectionPattern =
  /(?:^|\n)\s*(?:#{1,6}\s*)?(?:第[一二三四五六七八九十]+部分\s*[：:]\s*)?(全局(?:基础)?设定|时间轴与画面设计|分镜内容|产品一致性|背景元素|字幕样式)\s*/g;

function readableRows(content: string) {
  return content
    .split(/\s*(?:\n|\||；)\s*|(?<=。)(?!\s*[|｜])\s*/)
    .map((row) => row.trim())
    .filter(Boolean);
}

export function formatRemixPromptSections(prompt: string): RemixPromptSection[] {
  const normalized = prompt.replace(/\s*(第[一二三四五六七八九十]+部分\s*[：:]\s*)/g, "\n$1").trim();
  const matches = [...normalized.matchAll(sectionPattern)];
  if (!matches.length) return [{ title: "提示词", rows: readableRows(normalized) }];

  const leading = normalized.slice(0, matches[0]?.index ?? 0).trim();
  const sections = matches.map((match, index) => {
    const contentStart = (match.index ?? 0) + match[0].length;
    const contentEnd = matches[index + 1]?.index ?? normalized.length;
    return { title: match[1] || "提示词", rows: readableRows(normalized.slice(contentStart, contentEnd)) };
  });

  return leading ? [{ title: "提示词", rows: readableRows(leading) }, ...sections] : sections;
}
