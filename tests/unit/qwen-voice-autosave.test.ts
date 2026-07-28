import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("AI tool output folder saving", () => {
  test("only saves Qwen and MediaKit results when each job has an explicit output folder", async () => {
    const qwen = await Bun.file(resolve(import.meta.dir, "../../worker/jobs/job-qwen-voice-clone.ts")).text();
    const mediaKit = await Bun.file(resolve(import.meta.dir, "../../worker/jobs/job-mediakit-video.ts")).text();
    const videoCut = await Bun.file(resolve(import.meta.dir, "../../worker/jobs/job-video-cut.ts")).text();
    const videoMashup = await Bun.file(resolve(import.meta.dir, "../../worker/jobs/job-video-mashup.ts")).text();

    expect(qwen).toContain("if (job.values.outputFolderId)");
    expect(qwen).toContain('accounts.getAssetFolder(job.ownerUserId, job.values.outputFolderId ?? "")');
    expect(qwen).not.toContain("accounts.getDefaultAssetFolderId(job.ownerUserId)");
    expect(qwen).toContain("ossutils.putLibraryBytes");
    expect(qwen).toContain("accounts.createAsset");
    expect(qwen).toContain('mimeType: "audio/wav"');
    expect(mediaKit).toContain('accounts.getAssetFolder(job.ownerUserId, job.values.outputFolderId ?? "")');
    expect(mediaKit).not.toContain("accounts.getDefaultAssetFolderId(job.ownerUserId)");
    expect(mediaKit).toContain("accounts.createArtifact");
    expect(mediaKit).toMatch(/artifactUrl = `\/api\/artifacts\/\$\{assetId\}\/access`/);
    for (const handler of [videoCut, videoMashup]) {
      expect(handler).toContain("accounts.createArtifact");
      expect(handler).toMatch(/artifactUrl = `\/api\/artifacts\/\$\{assetId\}\/access`/);
      expect(handler).toContain("if (folder)");
    }
  });
});
