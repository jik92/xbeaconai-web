import { describe, expect, test } from "bun:test";

describe("Blob-free Web policy", () => {
  test("keeps production source free of browser Blob URLs", async () => {
    const forbidden = ["URL.createObjectURL", "URL.revokeObjectURL", "blob:"];
    const violations: string[] = [];
    for (const directory of ["web", "server", "worker", "shared"]) {
      for (const file of new Bun.Glob(`${directory}/**/*.{ts,tsx}`).scanSync()) {
        const source = await Bun.file(file).text();
        for (const token of forbidden) if (source.includes(token)) violations.push(`${file}: ${token}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
