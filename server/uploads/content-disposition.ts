export function inlineUtf8ContentDisposition(fileName: string) {
  const safeName = fileName.replace(/[\u0000-\u001f\u007f]/g, "");
  const encoded = [...new TextEncoder().encode(safeName)]
    .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`)
    .join("");
  return `inline; filename*=UTF-8''${encoded}`;
}
