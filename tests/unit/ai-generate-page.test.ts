import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");

describe("assistant-ui AI Generate page", () => {
  test("uses official chat primitives without legacy Mock or page CSS", () => {
    const page = readFileSync(resolve(root, "web/features/ai-generate/ai-generate-page.tsx"), "utf8");
    const promptWorkbench = readFileSync(resolve(root, "web/components/domain/prompt-workbench.tsx"), "utf8");

    expect(page).toContain('from "@assistant-ui/react"');
    expect(page).toContain("ThreadPrimitive");
    expect(page).toContain("MessagePrimitive");
    expect(page).toContain("ComposerPrimitive");
    expect(page).toContain("AttachmentPrimitive");
    expect(page).toContain("ActionBarPrimitive");
    expect(page).toContain("Unstable_TriggerPopover");
    expect(page).toContain("unstable_useMentionAdapter");
    expect(page).not.toContain("AiGenerateMockStore");
    expect(page).not.toContain('import "./ai-generate.css"');
    expect(promptWorkbench).not.toContain("ai-generate.css");
  });

  test("submits real tasks and preserves revision lineage", () => {
    const page = readFileSync(resolve(root, "web/features/ai-generate/ai-generate-page.tsx"), "utf8");
    const apiClient = readFileSync(resolve(root, "web/api/api-client.ts"), "utf8");
    const server = readFileSync(resolve(root, "server/app.ts"), "utf8");
    const worker = readFileSync(resolve(root, "worker/jobs/job-ai-generate.ts"), "utf8");

    expect(page).toContain("submitAiGenerateJob");
    expect(page).toContain("parentJobId");
    expect(page).toContain("revisionMode");
    expect(apiClient).toContain("createAiGenerateJob");
    expect(server).toContain('operationId: "createAiGenerateJob"');
    expect(worker).toContain('initialJob.values.allowMockFallback !== "false"');
  });
});
