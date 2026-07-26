const cssTypography =
  /\b(?:font-family|font-size|font-weight|line-height|letter-spacing|font-style|text-transform|text-decoration|text-shadow)\s*:|(?:^|[;{]\s*)color\s*:|\bfont\s*:/;
const inlineTypography =
  /\b(?:fontFamily|fontSize|fontWeight|lineHeight|letterSpacing|fontStyle|color|backgroundColor)\s*:/;
const arbitraryTypography = /\b(?:text|font|leading|tracking)-\[[^\]]+\]/;
const directVisualTypography =
  /\btext-(?:2xs|xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl)\b|\bfont-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b/;
const forbiddenFamily = /\bfont-(?:mono|serif)\b/;
const numericLeading = /\bleading-(?:\d|\[)/;
const forbiddenPaletteUtility =
  /\b(?:text|bg|border|ring|fill|stroke|from|via|to)-(?:white|black|slate|gray|zinc|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d+)?(?:\/\d+)?\b|\bbg-gradient-/;
const allowedCss = /^\s*font:\s*inherit;\s*$/;
const hardcodedColor = /#[\da-f]{3,8}\b|\brgba?\(|:\s*(?:white|black)(?:\s|;|$)/i;
const microTypography = /\btype-micro(?:-strong)?\b/;
const microTypographyFiles = new Set([
  "web/components/domain/media-preview.tsx",
  "web/features/asset-library/asset-library.css",
  "web/features/scene-library/scene-library.tsx",
  "web/features/video-remix/remix-project.css",
  "web/styles/globals.css",
]);

export function typographyViolationsForSource(file: string, source: string): string[] {
  if (file === "web/styles/tailwind.css") return [];
  const violations: string[] = [];
  for (const [index, line] of source.split("\n").entries()) {
    const sharedViolation =
      arbitraryTypography.test(line) ||
      directVisualTypography.test(line) ||
      forbiddenFamily.test(line) ||
      numericLeading.test(line) ||
      forbiddenPaletteUtility.test(line) ||
      (microTypography.test(line) && !microTypographyFiles.has(file));
    const fileViolation = file.endsWith(".css")
      ? !allowedCss.test(line) && (cssTypography.test(line) || hardcodedColor.test(line))
      : inlineTypography.test(line) || hardcodedColor.test(line);
    if (sharedViolation || fileViolation) violations.push(`${file}:${index + 1}: ${line.trim()}`);
  }
  return violations;
}

if (import.meta.main) {
  const files: string[] = [];
  for (const pattern of ["web/**/*.css", "web/**/*.ts", "web/**/*.tsx"]) {
    for await (const file of new Bun.Glob(pattern).scan(".")) files.push(file);
  }

  const violations: string[] = [];
  for (const file of files.sort()) {
    violations.push(...typographyViolationsForSource(file, await Bun.file(file).text()));
  }

  if (violations.length) {
    console.error("Typography must use the approved semantic type utilities only:\n");
    console.error(violations.join("\n"));
    process.exit(1);
  }

  console.log(`Typography check passed (${files.length} files).`);
}
