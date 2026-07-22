import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("ad script entry", () => {
  test("always starts from the form without restoring an active project", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../web/features/ad-script/ad-script-page.tsx")).text();

    expect(source).toContain('useState<"form" | "progress" | "result">("form")');
    expect(source).toContain('const [projectId, setProjectId] = useState("")');
    expect(source).toContain("localStorage.removeItem(legacyActiveProjectKey)");
    expect(source).not.toContain("localStorage.getItem(activeProjectKey)");
    expect(source).not.toContain("localStorage.setItem(activeProjectKey");
  });

  test("uses shared UI components without exposing the underlying model", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../web/features/ad-script/ad-script-page.tsx")).text();

    expect(source).toContain('from "@/components/ui/button"');
    expect(source).toContain('from "@/components/ui/card"');
    expect(source).toContain('from "@/components/ui/input"');
    expect(source).toContain('from "@/components/ui/label"');
    expect(source).toContain('from "@/components/ui/native-select"');
    expect(source).not.toMatch(/deepseek/i);
    expect(source).not.toContain('import "./ad-script-page.css"');
  });
});
