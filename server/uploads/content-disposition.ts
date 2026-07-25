export function inlineUtf8ContentDisposition(fileName: string) {
  const safeName = [...fileName]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join("");
  const encoded = [...new TextEncoder().encode(safeName)]
    .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`)
    .join("");
  return `inline; filename*=UTF-8''${encoded}`;
}
