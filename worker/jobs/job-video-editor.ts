import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { probeMedia } from "../../server/media/ffmpeg";
import { ossutils } from "../../server/storage/ossutils";
import type { JobResult, StageProvenance } from "../../server/types";
import { type VideoEditorTimeline, validateVideoEditorTimeline } from "../../shared/video-editor/timeline";
import type { WorkerJobHandler } from "./types";

let serveUrlPromise: Promise<string> | undefined;
const remotionServeUrl = () =>
  (serveUrlPromise ??= bundle({ entryPoint: resolve(import.meta.dir, "../remotion/entry.tsx") }));

export const videoEditorJob: WorkerJobHandler = {
  name: "video-editor",
  supports: (job) => job.moduleId === "video-editor",
  async execute(job, context) {
    const { accounts } = context;
    if (!accounts) throw new Error("素材所有权服务不可用");
    if (!ossutils.configured) throw new Error("TOS_NOT_CONFIGURED: 视频剪辑导出必须保存到私有 TOS");
    const folder = accounts.getAssetFolder(job.ownerUserId, job.values.outputFolderId ?? "");
    if (!folder) throw new Error("保存文件夹不存在或不属于当前账号");
    let timeline: VideoEditorTimeline;
    try {
      timeline = JSON.parse(job.values.timeline ?? "") as VideoEditorTimeline;
    } catch {
      throw new Error("剪辑时间线格式无效");
    }
    const invalid = validateVideoEditorTimeline(timeline);
    if (invalid) throw new Error(invalid);
    const tempDir = await mkdtemp(resolve(tmpdir(), "yaozuo-video-editor-"));
    const plan: StageProvenance[] = [
      {
        id: `${job.id}:render`,
        capability: "remotion-render",
        executionMode: "local",
        implementation: "remotion-renderer-v4",
        startedAt: new Date().toISOString(),
      },
    ];
    try {
      context.change(job.id, {
        status: "processing",
        stage: "正在准备剪辑素材",
        progress: 5,
        executionPlan: plan,
        provenance: plan,
        overallExecutionMode: "local",
      });
      for (const source of timeline.sources) {
        const asset = accounts.getOwnedAsset(job.ownerUserId, source.assetId);
        if (!asset?.mimeType.startsWith("video/")) throw new Error(`源素材“${source.name}”不存在或不属于当前账号`);
        source.url = ossutils.createSignedReadUrl(asset.storageKey, 2 * 60 * 60);
      }
      const outputPath = resolve(tempDir, "output.mp4");
      const serveUrl = await remotionServeUrl();
      const composition = await selectComposition({ serveUrl, id: "VideoEditor", inputProps: { timeline } });
      await renderMedia({
        serveUrl,
        composition,
        codec: "h264",
        outputLocation: outputPath,
        inputProps: { timeline },
        onProgress: ({ progress }) =>
          context.change(job.id, { stage: "正在使用 Remotion 渲染", progress: Math.round(10 + progress * 75) }),
      });
      const media = await probeMedia(outputPath);
      const video = media.streams.find((stream) => stream.codec_type === "video");
      const file = Bun.file(outputPath);
      const name = (job.values.outputName || "剪辑成片.mp4").replace(/[^\p{L}\p{N}._-]+/gu, "-");
      const assetId = crypto.randomUUID();
      const storageKey = `${folder.storagePrefix}generated/${job.id}/${name}`;
      context.change(job.id, { stage: "正在保存到素材库", progress: 90 });
      await ossutils.putLibraryFile({
        filePath: outputPath,
        key: storageKey,
        mimeType: "video/mp4",
        sizeBytes: file.size,
      });
      accounts.createAsset({
        id: assetId,
        ownerUserId: job.ownerUserId,
        storageKey,
        originalName: name,
        mimeType: "video/mp4",
        byteSize: file.size,
        width: video?.width,
        height: video?.height,
        durationSec: Number(media.format.duration ?? 0) || undefined,
        kind: "media",
        displayName: name.replace(/\.mp4$/, ""),
        description: `由视频剪辑任务 ${job.id} 创建`,
        folderId: folder.id,
        createdAt: new Date().toISOString(),
      });
      plan[0]!.completedAt = new Date().toISOString();
      const artifacts: JobResult["artifacts"] = [
        {
          id: assetId,
          name,
          mimeType: "video/mp4",
          url: `/api/assets/${assetId}/content`,
          executionMode: "local",
          lineage: plan,
        },
      ];
      context.change(job.id, {
        status: "succeeded",
        stage: "已保存到素材库",
        progress: 100,
        provenance: plan,
        result: {
          kind: "video-editor",
          title: job.title,
          summary: `剪辑成片已保存到“${folder.name}”。`,
          artifacts,
          data: { values: job.values, generatedAt: new Date().toISOString(), mock: false },
        },
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  },
};
