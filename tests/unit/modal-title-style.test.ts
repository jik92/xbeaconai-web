import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const modalSources = [
  "../../web/components/domain/attachment-picker.tsx",
  "../../web/features/account/workspace-panels.tsx",
  "../../web/features/admin/admin-page.tsx",
  "../../web/features/video-create/video-create-page.tsx",
  "../../web/features/video-remix/remix-project.tsx",
];

const removedEyebrows = [
  "ATTACHMENT",
  "ASSET LIBRARY",
  "PRODUCT LIBRARY",
  "PORTRAIT LIBRARY",
  "PROJECT HISTORY",
  "QUEUE JOB",
  "MOCK PAYMENT",
  "PREFERENCES",
  "NOTIFICATIONS",
];

describe("modal title style", () => {
  test("keeps modal headers free of English eyebrow labels", async () => {
    const sources = await Promise.all(modalSources.map((path) => Bun.file(resolve(import.meta.dir, path)).text()));
    const combined = sources.join("\n");

    for (const eyebrow of removedEyebrows) expect(combined).not.toContain(eyebrow);
  });
});
