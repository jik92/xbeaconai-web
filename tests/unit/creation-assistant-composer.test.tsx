import { describe, expect, test } from "bun:test";
import { AssistantRuntimeProvider, type ThreadMessageLike, useExternalStoreRuntime } from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CreationAssistantComposer,
  CreationAssistantThread,
} from "../../web/components/domain/creation-assistant-composer";
import { AiGeneratePage } from "../../web/features/ai-generate/ai-generate-page";
import { MediaUnderstandPage } from "../../web/features/media-understand/media-understand-page";

function SharedComposerFixture() {
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: [],
    convertMessage: (message) => message,
    onNew: async () => {},
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <CreationAssistantThread
        title="素材理解"
        composer={
          <CreationAssistantComposer
            references={[]}
            placeholder="描述素材理解要求"
            controls={<button type="button">思考深度：标准</button>}
            attachment={{
              accept: "image/*,video/*,audio/*",
              multiple: true,
              onSelect: () => {},
            }}
            sendLabel="分析"
            sendAriaLabel="发送素材理解任务"
            sendDisabled={false}
            onRemoveReference={() => {}}
          />
        }
      />
    </AssistantRuntimeProvider>
  );
}

describe("shared assistant creation composer", () => {
  test("owns the same thread, input, attachment and send interaction for every business mode", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <SharedComposerFixture />
      </QueryClientProvider>,
    );

    expect(html).toContain('data-creation-assistant-thread="true"');
    expect(html).toContain('data-creation-assistant-composer="true"');
    expect(html).toContain("rounded-2xl border border-line bg-surface p-3 shadow-sm");
    expect(html).toContain("描述素材理解要求");
    expect(html).toContain("思考深度：标准");
    expect(html).toContain("添加参考素材");
    expect(html).toContain('aria-label="发送素材理解任务"');
    expect(html).toContain(">分析<");
  });

  test("renders both routed business pages through the same thread and composer implementation", () => {
    const renderPage = (element: React.ReactElement, entries: Array<[readonly unknown[], unknown]>) => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      for (const [key, value] of entries) queryClient.setQueryData(key, value);
      return renderToStaticMarkup(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
    };
    const aiCreation = renderPage(<AiGeneratePage />, [
      [["creation-capabilities"], { models: [] }],
      [["api-tasks", "ai-generate"], []],
    ]);
    const materialUnderstanding = renderPage(<MediaUnderstandPage />, [
      [
        ["media-understand-capabilities"],
        {
          models: [
            {
              id: "doubao-seed-2-0-lite-260428",
              displayName: "字节Seed 2.0 Lite",
              description: "全模态理解",
              badges: [],
              enabled: true,
              isDefault: true,
              acceptedPrimaryKinds: ["image", "video", "audio"],
            },
          ],
          reasoningEfforts: ["off", "medium", "high"],
        },
      ],
      [["api-tasks", "media-understand"], []],
    ]);

    for (const html of [aiCreation, materialUnderstanding]) {
      expect(html).toContain('data-creation-assistant-thread="true"');
      expect(html).toContain('data-creation-assistant-composer="true"');
      expect(html).toContain("rounded-2xl border border-line bg-surface p-3 shadow-sm");
      expect(html).toContain("sticky bottom-0 mx-auto w-full max-w-4xl");
    }
    expect(materialUnderstanding).toContain('aria-label="素材理解模型"');
    expect(materialUnderstanding).toContain('aria-label="思考深度"');
    expect(materialUnderstanding).toContain("添加参考素材");
    expect(materialUnderstanding).not.toContain("简洁版");
    expect(materialUnderstanding).not.toContain("生图");
    expect(materialUnderstanding).not.toContain('aria-label="画幅"');
  });
});
