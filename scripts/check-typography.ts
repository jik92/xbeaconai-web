export {};

const cssTypography = /\b(?:font-family|font-size|font-weight|line-height|letter-spacing)\s*:|\bfont\s*:/;
const inlineTypography = /\b(?:fontFamily|fontSize|fontWeight|lineHeight|letterSpacing)\s*:/;
const arbitraryTypography = /\b(?:text|font|leading|tracking)-\[[^\]]+\]/;
const forbiddenWeight = /\bfont-(?:thin|extralight|bold|extrabold|black)\b/;
const allowedCss = /^\s*font:\s*inherit;\s*$/;

const files: string[] = [];
for (const pattern of ["web/**/*.css", "web/**/*.ts", "web/**/*.tsx"]) {
  for await (const file of new Bun.Glob(pattern).scan(".")) files.push(file);
}

const violations: string[] = [];
for (const file of files.sort()) {
  if (file === "web/styles/tailwind.css") continue;
  const lines = (await Bun.file(file).text()).split("\n");
  for (const [index, line] of lines.entries()) {
    if (file.endsWith(".css")) {
      if (allowedCss.test(line)) continue;
      if (cssTypography.test(line) || arbitraryTypography.test(line) || forbiddenWeight.test(line)) {
        violations.push(`${file}:${index + 1}: ${line.trim()}`);
      }
      continue;
    }
    if (inlineTypography.test(line) || arbitraryTypography.test(line) || forbiddenWeight.test(line)) {
      violations.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  }
}

if (violations.length) {
  console.error("Typography must use Tailwind theme utilities only:\n");
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log(`Typography check passed (${files.length} files).`);
