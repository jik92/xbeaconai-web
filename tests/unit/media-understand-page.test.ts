import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppendMessage } from "@assistant-ui/react";
import type { Job } from "../../web/api/generated/types.gen";
import {
  buildMediaUnderstandSubmission,
  classifyMediaUnderstandSelection,
  mediaUnderstandJobsToThreadMessages,
  mediaUnderstandReferenceLabels,
  mediaUnderstandReferencesFromAppendMessage,
} from "../../web/features/media-understand/media-understand-runtime";

const root = resolve(import.meta.dir, "../..");

describe("media understanding page", () => {
  test("uses the routed AI creation assistant composer and thread without a custom workbench", () => {
    const page = readFileSync(resolve(root, "web/features/media-understand/media-understand-page.tsx"), "utf8");

    expect(page).toContain("CreationAssistantComposer");
    expect(page).toContain("CreationAssistantThread");
    expect(page).toContain("<CreationAssistantComposer");
    expect(page).toContain("<CreationAssistantThread");
    expect(page).toContain("AssistantRuntimeProvider");
    expect(page).toContain("submitMediaUnderstandJob");
    expect(page).not.toContain("CreationComposerShell");
    expect(page).not.toContain("ComposerPanel");
  });

  test("assigns one primary media and at most five product reference images", () => {
    const selected = classifyMediaUnderstandSelection(
      [
        { id: "video", name: "source.mp4", mimeType: "video/mp4" },
        ...Array.from({ length: 6 }, (_, index) => ({
          id: `image-${index}`,
          name: `product-${index}.png`,
          mimeType: "image/png",
        })),
      ],
      [],
    );
    expect(selected.references).toHaveLength(5);
    expect(selected.primary?.id).toBe("video");
    expect(selected.rejected).toEqual(["product-5.png"]);
  });

  test("uses the first image as primary and later images as product references", () => {
    const selected = classifyMediaUnderstandSelection(
      [
        { id: "image-1", name: "source.png", mimeType: "image/png" },
        { id: "image-2", name: "product.png", mimeType: "image/png" },
      ],
      [],
    );
    expect(selected.primary?.id).toBe("image-1");
    expect(selected.references.map((item) => item.id)).toEqual(["image-2"]);
    expect(mediaUnderstandReferenceLabels(selected.primary, selected.references)).toEqual(
      new Map([
        ["image-1", "主素材"],
        ["image-2", "商品参考图 1"],
      ]),
    );
  });

  test("builds the dedicated material-understanding request from the shared composer state", () => {
    expect(
      buildMediaUnderstandSubmission({
        modelId: "doubao-seed-2-0-lite-260428",
        reasoningEffort: "high",
        prompt: "  将皮带替换为透明玻璃大茶缸  ",
        primary: { id: "video", name: "source.mp4", mimeType: "video/mp4" },
        references: [
          { id: "cup-1", name: "cup-front.png", mimeType: "image/png" },
          { id: "cup-2", name: "cup-side.png", mimeType: "image/png" },
        ],
      }),
    ).toEqual({
      modelId: "doubao-seed-2-0-lite-260428",
      reasoningEffort: "high",
      prompt: "将皮带替换为透明玻璃大茶缸",
      primaryAssetId: "video",
      referenceImageAssetIds: ["cup-1", "cup-2"],
    });
  });

  test("maps each material-understanding job into the shared user and assistant message flow", () => {
    const job = {
      id: "job-1",
      title: "透明玻璃大茶缸镜头脚本",
      status: "succeeded",
      stage: "镜头脚本已生成",
      progress: 100,
      createdAt: "2026-07-29T05:00:00.000Z",
      updatedAt: "2026-07-29T05:01:00.000Z",
      overallExecutionMode: "real",
      values: {
        prompt: "将皮带替换成透明玻璃大茶缸",
        primaryAssetId: "video-1",
        referenceImageAssetIds: '["cup-1"]',
        referenceMetadata:
          '[{"id":"video-1","name":"source.mp4","mimeType":"video/mp4","label":"主素材"},{"id":"cup-1","name":"cup.png","mimeType":"image/png","label":"商品参考图 1"}]',
      },
      result: {
        summary: "镜头脚本已生成",
        artifacts: [
          {
            id: "artifact-1",
            name: "script.json",
            mimeType: "application/json",
            text: '{"title":"透明玻璃大茶缸"}',
            executionMode: "real",
          },
        ],
      },
    } as unknown as Job;

    const messages = mediaUnderstandJobsToThreadMessages([job]);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: "job-1:user",
      role: "user",
      content: [{ type: "text", text: "将皮带替换成透明玻璃大茶缸" }],
    });
    expect(messages[1]).toMatchObject({
      id: "job-1:assistant",
      role: "assistant",
      content: [{ type: "data", name: "media-understand-result" }],
    });
  });

  test("reads the selected primary material from assistant-ui message attachments when submitting", () => {
    const primary = {
      id: "video-1",
      name: "source.mp4",
      mimeType: "video/mp4",
      label: "主素材",
    };
    const message = {
      role: "user",
      content: [{ type: "text", text: "分析视频" }],
      attachments: [
        {
          id: primary.id,
          type: primary.label,
          name: primary.name,
          contentType: primary.mimeType,
          content: [{ type: "data", name: "media-understand-reference", data: primary }],
        },
      ],
    } as unknown as AppendMessage;

    const references = mediaUnderstandReferencesFromAppendMessage(message);
    const selection = classifyMediaUnderstandSelection(references, []);

    expect(references).toEqual([primary]);
    expect(selection.primary).toEqual(primary);
    if (!selection.primary) throw new Error("expected the attached video to be the primary material");
    expect(
      buildMediaUnderstandSubmission({
        modelId: "doubao-seed-2-0-lite-260428",
        reasoningEffort: "medium",
        prompt: "分析视频",
        primary: selection.primary,
        references: selection.references,
      }),
    ).toMatchObject({ primaryAssetId: "video-1" });
  });
});
