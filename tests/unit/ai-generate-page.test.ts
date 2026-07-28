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
    expect(page).toContain("ActionBarPrimitive");
    expect(page).toContain("Unstable_TriggerPopover");
    expect(page).toContain("unstable_useMentionAdapter");
    expect(page).not.toContain("AiGenerateMockStore");
    expect(page).not.toContain('import "./ai-generate.css"');
    expect(promptWorkbench).not.toContain("ai-generate.css");
  });

  test("keeps the composer fixed while only the message viewport scrolls", () => {
    const page = readFileSync(resolve(root, "web/features/ai-generate/ai-generate-page.tsx"), "utf8");

    expect(page).toContain('className="flex h-[calc(100dvh-56px)] min-h-0 overflow-hidden bg-surface"');
    expect(page).toContain('className="flex min-h-0 flex-1 flex-col overflow-y-auto"');
    expect(page).toContain('className="sticky bottom-0 mx-auto w-full max-w-4xl shrink-0');
  });

  test("reuses the shared media result card for image and video artifacts", () => {
    const page = readFileSync(resolve(root, "web/features/ai-generate/ai-generate-page.tsx"), "utf8");
    const resultCard = readFileSync(resolve(root, "web/components/domain/media-result-card.tsx"), "utf8");

    expect(page).toContain('import { MediaResultCard } from "@/components/domain/media-result-card"');
    expect(page).toContain("<MediaResultCard");
    expect(page).not.toContain("<MediaPreview");
    expect(resultCard).toContain("<MediaPreview");
    expect(resultCard).toContain('kind === "image" || kind === "video"');
    expect(resultCard).toContain("data-media-result-kind={kind}");
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

  test("uses one model-aware entry for image and video reference media", () => {
    const page = readFileSync(resolve(root, "web/features/ai-generate/ai-generate-page.tsx"), "utf8");

    expect(page).toContain("添加参考素材");
    expect(page).toContain("referenceAccept(model)");
    expect(page).toContain("showMediaTypeFilters");
    expect(page).toContain("supportsMediaReference");
    expect(page).toContain("clearAttachments");
  });

  test("offers concise and professional composer modes with structured professional fields", () => {
    const page = readFileSync(resolve(root, "web/features/ai-generate/ai-generate-page.tsx"), "utf8");

    expect(page).toContain("简洁版");
    expect(page).toContain("专业版");
    expect(page).toContain("脚本");
    expect(page).toContain("环境与运镜");
    expect(page).toContain("强调点");
    expect(page).toContain("professionalPrompt");
  });

  test("keeps reference media visible before submission and in user message history", () => {
    const page = readFileSync(resolve(root, "web/features/ai-generate/ai-generate-page.tsx"), "utf8");

    expect(page).toContain("AiGenerateReferencePreview");
    expect(page).toContain("removeReference");
    expect(page).toContain("参考素材");
    expect(page).toContain("state.message.metadata?.custom");
    expect(page).toContain("removable={false}");
  });

  test("restores a completed task for manual editing and submits variants immediately", () => {
    const page = readFileSync(resolve(root, "web/features/ai-generate/ai-generate-page.tsx"), "utf8");
    const apiClient = readFileSync(resolve(root, "web/api/api-client.ts"), "utf8");

    expect(page).toContain("restoreRevision");
    expect(page).toContain("composer.setText(restoredPrompt)");
    expect(page).toContain("parseProfessionalPrompt(restoredPrompt)");
    expect(page).toContain('setComposerMode(professionalFields ? "professional" : "concise")');
    expect(page).toContain("setProfessionalFields(professionalFields)");
    expect(page).toContain("await composer.clearAttachments()");
    expect(page).toContain("submitVariant(source)");
    expect(page).toContain('revisionMode: "variant"');
    expect(page).toContain('part.name === "ai-generate-result"');
    expect(page).toContain("找不到对应的创作任务");
    expect(page).toContain("restoreRequest");
    expect(page).toContain("clearRestoreRequest");
    expect(page).toContain('source.status === "succeeded" ? source.id : undefined');
    expect(apiClient).toContain("AI 创作任务创建失败");
    expect(apiClient).toContain('reason && typeof reason === "object" && "error" in reason');
  });

  test("separates histories into manually named product conversations", () => {
    const page = readFileSync(resolve(root, "web/features/ai-generate/ai-generate-page.tsx"), "utf8");

    expect(page).toContain("新建对话");
    expect(page).toContain("产品名称");
    expect(page).toContain("groupAiGenerateConversations(jobs)");
    expect(page).toContain("activeConversationId");
    expect(page).toContain("conversationId: activeConversation?.id");
    expect(page).toContain("conversationName: activeConversation?.name");
    expect(page).toContain("createdConversations");
    expect(page).toContain("setCreatedConversations");
  });

  test("keeps the product conversation rail visible while chat messages scroll", () => {
    const page = readFileSync(resolve(root, "web/features/ai-generate/ai-generate-page.tsx"), "utf8");

    expect(page).toContain("h-[calc(100dvh-56px)]");
    expect(page).toContain("overflow-hidden");
    expect(page).toContain('aria-label="产品对话"');
  });
});
