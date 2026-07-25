import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("AI tool output folder saving", () => {
  test("saves Qwen and MediaKit results to each job's explicit output folder", async () => {
    const qwen = await Bun.file(resolve(import.meta.dir, "../../worker/jobs/job-qwen-voice-clone.ts")).text();
    const mediaKit = await Bun.file(resolve(import.meta.dir, "../../worker/jobs/job-mediakit-video.ts")).text();

    expect(qwen).toContain('job.values.autoSave === "true"');
    expect(qwen).toContain('accounts.getAssetFolder(job.ownerUserId, job.values.outputFolderId ?? "")');
    expect(qwen).not.toContain("accounts.getDefaultAssetFolderId(job.ownerUserId)");
    expect(qwen).toContain("ossutils.putLibraryBytes");
    expect(qwen).toContain("accounts.createAsset");
    expect(qwen).toContain('mimeType: "audio/wav"');
    expect(mediaKit).toContain('accounts.getAssetFolder(job.ownerUserId, job.values.outputFolderId ?? "")');
    expect(mediaKit).not.toContain("accounts.getDefaultAssetFolderId(job.ownerUserId)");
  });
});
