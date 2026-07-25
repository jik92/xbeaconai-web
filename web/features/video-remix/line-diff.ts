export type LineDiffKind = "unchanged" | "removed" | "added";

export interface LineDiff {
  before: Array<{ lineNumber: number; text: string; kind: Extract<LineDiffKind, "unchanged" | "removed"> }>;
  after: Array<{ lineNumber: number; text: string; kind: Extract<LineDiffKind, "unchanged" | "added"> }>;
}

function splitLines(value: string) {
  return value.replace(/\r\n?/g, "\n").split("\n");
}

/** Builds a small, dependency-free, line-oriented diff for prompt review. */
export function buildLineDiff(beforeValue: string, afterValue: string): LineDiff {
  const beforeLines = splitLines(beforeValue);
  const afterLines = splitLines(afterValue);
  const table = Array.from({ length: beforeLines.length + 1 }, () => new Uint32Array(afterLines.length + 1));

  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      table[beforeIndex][afterIndex] =
        beforeLines[beforeIndex] === afterLines[afterIndex]
          ? table[beforeIndex + 1][afterIndex + 1] + 1
          : Math.max(table[beforeIndex + 1][afterIndex], table[beforeIndex][afterIndex + 1]);
    }
  }

  const before: LineDiff["before"] = [];
  const after: LineDiff["after"] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeLines.length || afterIndex < afterLines.length) {
    if (
      beforeIndex < beforeLines.length &&
      afterIndex < afterLines.length &&
      beforeLines[beforeIndex] === afterLines[afterIndex]
    ) {
      before.push({ lineNumber: before.length + 1, text: beforeLines[beforeIndex], kind: "unchanged" });
      after.push({ lineNumber: after.length + 1, text: afterLines[afterIndex], kind: "unchanged" });
      beforeIndex += 1;
      afterIndex += 1;
    } else if (
      afterIndex < afterLines.length &&
      (beforeIndex === beforeLines.length || table[beforeIndex][afterIndex + 1] >= table[beforeIndex + 1][afterIndex])
    ) {
      after.push({ lineNumber: after.length + 1, text: afterLines[afterIndex], kind: "added" });
      afterIndex += 1;
    } else {
      before.push({ lineNumber: before.length + 1, text: beforeLines[beforeIndex], kind: "removed" });
      beforeIndex += 1;
    }
  }
  return { before, after };
}
