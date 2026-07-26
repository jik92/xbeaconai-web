import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const webRoot = resolve(import.meta.dir, "../../web");
const nativeButtonImplementation = "components/ui/button.tsx";

describe("shared compact button usage", () => {
  test("keeps native button markup inside the shared shadcn Button only", async () => {
    const violations: string[] = [];
    const importViolations: string[] = [];
    const files = new Bun.Glob("**/*.tsx").scan({ cwd: webRoot });

    for await (const file of files) {
      if (file === nativeButtonImplementation) continue;
      const source = await Bun.file(resolve(webRoot, file)).text();
      if (/<button\b/.test(source)) violations.push(file);
      if (/<Button\b/.test(source) && !source.includes('from "@/components/ui/button"')) importViolations.push(file);
    }

    expect(violations).toEqual([]);
    expect(importViolations).toEqual([]);
  });

  test("uses the compact size as the shared default", async () => {
    const source = await Bun.file(resolve(webRoot, nativeButtonImplementation)).text();

    expect(source).toContain('"icon-sm": "size-8"');
    expect(source).toContain('size: "sm"');
    expect(source).toContain("return <button");
  });

  test("does not opt product controls back into the roomier icon size", async () => {
    const violations: string[] = [];
    const files = new Bun.Glob("**/*.tsx").scan({ cwd: webRoot });

    for await (const file of files) {
      const source = await Bun.file(resolve(webRoot, file)).text();
      if (source.includes('size="icon"')) violations.push(file);
    }

    expect(violations).toEqual([]);
  });
});
