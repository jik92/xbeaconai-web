import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { aiToolModuleIds } from "../../shared/jobs/ai-tool-modules";
import { modules } from "../../web/app/routes";
import { ToolboxCreatorForm } from "../../web/components/domain/module-page";
import { QwenVoiceCloneModal } from "../../web/features/voice-clone/qwen-voice-clone-modal";

const aiTools = modules.filter((module) => module.group === "AI 工具箱");

describe("AI tool save locations", () => {
  test("keeps every AI task module reachable while grouping video mashup as a utility", () => {
    expect(aiToolModuleIds.map((id) => modules.find((module) => module.id === id)?.id)).toEqual([...aiToolModuleIds]);
    expect(modules.find((module) => module.id === "video-mashup")?.group).toBe("实用工具");
  });

  test("renders one save-location setting for every common AI tool task form", () => {
    for (const config of aiTools.filter((module) => module.id !== "voice-clone")) {
      const queryClient = new QueryClient();
      const html = renderToStaticMarkup(
        <QueryClientProvider client={queryClient}>
          <ToolboxCreatorForm
            config={config}
            values={{ outputFolderId: "folder-1" }}
            setValue={() => undefined}
            submitted={false}
            running={false}
            hydrated
            onCancel={() => undefined}
            onSubmit={() => undefined}
          />
        </QueryClientProvider>,
      );
      expect(html.match(/aria-label="保存位置"/g)).toHaveLength(1);
      expect(html).not.toContain('required=""');
    }
  });

  test("renders the shared save-location setting in the Qwen voice task form", () => {
    const queryClient = new QueryClient();
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <QwenVoiceCloneModal open onClose={() => undefined} onCreated={() => undefined} />
      </QueryClientProvider>,
    );

    expect(html).toContain('aria-label="保存位置"');
  });
});
