import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("Qwen voice automatic asset saving", () => {
  test("saves the WAV to the owner's default asset folder when enabled", async () => {
    const source = await Bun.file(resolve(import.meta.dir, "../../worker/jobs/job-qwen-voice-clone.ts")).text();

    expect(source).toContain('job.values.autoSave === "true"');
    expect(source).toContain("accounts.getDefaultAssetFolderId(job.ownerUserId)");
    expect(source).toContain("ossutils.putLibraryBytes");
    expect(source).toContain("accounts.createAsset");
    expect(source).toContain('kind: "media"');
    expect(source).toContain('mimeType: "audio/wav"');
    expect(source).toContain(`/api/assets/\${artifactId}/content`);
    expect(source).toContain("accounts.createArtifact");
  });
});
