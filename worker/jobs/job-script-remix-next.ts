import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, resolve } from "node:path";
import type { MediaAsset } from "../../server/accounts/account-store";
import { cropStoryboardGrid, probeMedia } from "../../server/media/ffmpeg";
import { type AihubmixImageResult, aihubmix } from "../../server/providers/aihubmix";
import {
  analyzeScriptRemixNext,
  buildSingleShotImagePrompt,
  buildStoryboardGridPrompt,
} from "../../server/script-remix-next/model";
import { ossutils } from "../../server/storage/ossutils";
import type { StageProvenance } from "../../server/types";
import {
  type ScriptRemixNextShot,
  scriptRemixNextAnalysisModel,
  scriptRemixNextImageModel,
} from "../../shared/script-remix-next/workflow";
import type { WorkerJobHandler } from "./types";

interface ScriptRemixNextDependencies {
  analyze?: typeof analyzeScriptRemixNext;
  generateImages?: (input: {
    prompt: string;
    images: Array<{ bytes: Uint8Array; mimeType: string; name: string }>;
  }) => Promise<AihubmixImageResult[]>;
  fetchResult?: (url: string) => Promise<Uint8Array>;
  download?: (asset: MediaAsset, path: string) => Promise<void>;
  upload?: (input: { path: string; key: string; mimeType: string; size: number }) => Promise<void>;
}

export function decodeScriptDocument(bytes: Uint8Array, mimeType: string, name: string) {
  if (bytes.byteLength > 2 * 1024 * 1024) throw new Error("SCRIPT_DOCUMENT_TOO_LARGE");
  if (!(["text/plain", "text/markdown"].includes(mimeType) || /\.(?:txt|md)$/i.test(name)))
    throw new Error("SCRIPT_DOCUMENT_TYPE_UNSUPPORTED");
  const decoded = new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .replace(/^\uFEFF/, "")
    .trim();
  if (decoded.length < 20) throw new Error("SCRIPT_DOCUMENT_TOO_SHORT");
  if (decoded.length > 120_000) throw new Error("SCRIPT_DOCUMENT_TOO_LONG");
  return decoded;
}

function parseJson<T>(value: string | undefined, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function resultBytes(result: AihubmixImageResult, fetchResult: (url: string) => Promise<Uint8Array>) {
  if (result.b64Json) return new Uint8Array(Buffer.from(result.b64Json, "base64"));
  if (result.url) return fetchResult(result.url);
  throw new Error("SCRIPT_REMIX_NEXT_IMAGE_EMPTY");
}

async function defaultFetchResult(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`SCRIPT_REMIX_NEXT_IMAGE_DOWNLOAD_${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export function createScriptRemixNextJob(dependencies: ScriptRemixNextDependencies = {}): WorkerJobHandler {
  const analyze = dependencies.analyze ?? analyzeScriptRemixNext;
  const generateImages =
    dependencies.generateImages ??
    ((input) =>
      input.images.length
        ? aihubmix.editImages({
            prompt: input.prompt,
            images: input.images,
            model: scriptRemixNextImageModel,
            size: "1024x1536",
            count: 1,
            quality: "low",
          })
        : aihubmix.generateImages({
            prompt: input.prompt,
            model: scriptRemixNextImageModel,
            size: "1024x1536",
            count: 1,
            quality: "low",
          }));
  const fetchResult = dependencies.fetchResult ?? defaultFetchResult;

  return {
    name: "script-remix-next",
    supports: (job) =>
      job.moduleId === "script-remix-next" &&
      ["analysis", "storyboard", "reference-image"].includes(job.values.workflowPhase || ""),
    async execute(job, context) {
      const { accounts } = context;
      if (!accounts) throw new Error("ACCOUNT_STORE_UNAVAILABLE");
      if (!ossutils.configured && (!dependencies.download || !dependencies.upload))
        throw new Error("TOS_NOT_CONFIGURED");
      const phase = job.values.workflowPhase;
      const tempDir = await mkdtemp(resolve(tmpdir(), `yaozuo-script-remix-next-${phase}-`));
      const download = async (asset: MediaAsset, path: string) => {
        if (dependencies.download) return dependencies.download(asset, path);
        await ossutils.downloadLibraryFile(asset.storageKey, path);
      };
      const upload = async (path: string, key: string, mimeType: string, size: number) => {
        if (dependencies.upload) return dependencies.upload({ path, key, mimeType, size });
        await ossutils.putLibraryFile({ filePath: path, key, mimeType, sizeBytes: size });
      };
      try {
        if (phase === "analysis") {
          const document = accounts.getOwnedAsset(job.ownerUserId, job.values.documentAssetId || "");
          if (!document) throw new Error("SCRIPT_DOCUMENT_NOT_FOUND");
          const path = resolve(tempDir, `script${extname(document.originalName) || ".txt"}`);
          await download(document, path);
          const script = decodeScriptDocument(
            new Uint8Array(await Bun.file(path).arrayBuffer()),
            document.mimeType,
            document.originalName,
          );
          const stage: StageProvenance = {
            id: `${job.id}:analysis`,
            capability: "text-understand",
            executionMode: "real",
            implementation: "aihubmix-chat-completions",
            provider: "aihubmix",
            model: scriptRemixNextAnalysisModel,
            startedAt: new Date().toISOString(),
          };
          context.change(job.id, {
            status: "processing",
            stage: "正在解析脚本文档",
            progress: 15,
            provenance: [stage],
          });
          const result = await analyze({
            script,
            productName: job.values.productName || "未命名商品",
            productDescription: job.values.productDescription || "",
            portraitName: job.values.portraitName,
            voiceName: job.values.voiceName,
          });
          stage.model = result.model;
          stage.completedAt = new Date().toISOString();
          const values = { ...job.values, scriptText: script, shots: JSON.stringify(result.shots) };
          context.change(job.id, {
            status: "succeeded",
            stage: `已生成 ${result.shots.length} 个分镜`,
            progress: 100,
            values,
            provenance: [stage],
            result: {
              kind: "script-remix-next-analysis",
              title: job.title,
              summary: `已从文档解析 ${result.shots.length} 个分镜。`,
              artifacts: [],
              data: { values, generatedAt: new Date().toISOString(), mock: false },
            },
          });
          return;
        }

        if (phase !== "storyboard" && phase !== "reference-image") throw new Error("SCRIPT_REMIX_NEXT_PHASE_INVALID");
        const root = context.store.getOwned(job.parentJobId || "", job.ownerUserId);
        if (root?.moduleId !== "script-remix-next") throw new Error("SCRIPT_REMIX_NEXT_PROJECT_NOT_FOUND");
        const shots = parseJson<ScriptRemixNextShot[]>(job.values.shots || root.values.shots, []);
        const selectedShots =
          phase === "reference-image" ? shots.filter((shot) => shot.id === job.values.shotId) : shots;
        if (!selectedShots.length) throw new Error("SCRIPT_REMIX_NEXT_SHOTS_EMPTY");
        const selectedShot = selectedShots[0];
        if (!selectedShot) throw new Error("SCRIPT_REMIX_NEXT_SHOTS_EMPTY");
        const referenceIds = parseJson<string[]>(job.values.referenceAssetIds || root.values.referenceAssetIds, []);
        const referenceAssets = referenceIds
          .map((id) => accounts.getOwnedAsset(job.ownerUserId, id))
          .filter((asset): asset is MediaAsset => Boolean(asset?.mimeType.startsWith("image/")));
        const references: Array<{ bytes: Uint8Array; mimeType: string; name: string }> = [];
        for (const [index, asset] of referenceAssets.entries()) {
          const path = resolve(tempDir, `reference-${index}${extname(asset.originalName) || ".img"}`);
          await download(asset, path);
          references.push({
            bytes: new Uint8Array(await Bun.file(path).arrayBuffer()),
            mimeType: asset.mimeType,
            name: asset.originalName,
          });
        }
        const prompt =
          phase === "storyboard"
            ? buildStoryboardGridPrompt({
                shots,
                productName: root.values.productName || "未命名商品",
                portraitName: root.values.portraitName,
              })
            : buildSingleShotImagePrompt({
                shot: selectedShot,
                productName: root.values.productName || "未命名商品",
                portraitName: root.values.portraitName,
              });
        const stage: StageProvenance = {
          id: `${job.id}:image`,
          capability: "image-generate",
          executionMode: "real",
          implementation: "openai-images",
          provider: "aihubmix",
          model: scriptRemixNextImageModel,
          startedAt: new Date().toISOString(),
        };
        context.change(job.id, { status: "processing", stage: "正在生成分镜稿件", progress: 15, provenance: [stage] });
        const generated = await generateImages({ prompt, images: references });
        const bytes = await resultBytes(generated[0] || {}, fetchResult);
        const imagePath = resolve(tempDir, phase === "storyboard" ? "storyboard.png" : "reference.png");
        await Bun.write(imagePath, bytes);
        const media = await probeMedia(imagePath);
        const imageStream = media.streams.find((stream) => stream.codec_type === "video");
        if (!imageStream) throw new Error("SCRIPT_REMIX_NEXT_IMAGE_INVALID");
        const folder = accounts.getAssetFolder(job.ownerUserId, accounts.getDefaultAssetFolderId(job.ownerUserId));
        if (!folder) throw new Error("OUTPUT_FOLDER_NOT_FOUND");
        const artifacts: NonNullable<Parameters<typeof context.change>[1]["result"]>["artifacts"] = [];
        const saveImage = async (path: string, name: string, width?: number, height?: number) => {
          const assetId = crypto.randomUUID();
          const file = Bun.file(path);
          const key = `${folder.storagePrefix}generated/${job.id}/${name}`;
          await upload(path, key, "image/png", file.size);
          accounts.createAsset({
            id: assetId,
            ownerUserId: job.ownerUserId,
            storageKey: key,
            originalName: name,
            mimeType: "image/png",
            byteSize: file.size,
            width,
            height,
            kind: "media",
            displayName: name.replace(/\.png$/, ""),
            description: `脚本二创【新】${phase === "storyboard" ? "九宫格" : "单格参考图"}`,
            folderId: folder.id,
            createdAt: new Date().toISOString(),
          });
          artifacts.push({
            id: assetId,
            name,
            mimeType: "image/png",
            url: `/api/assets/${assetId}/access`,
            executionMode: "real",
            lineage: [stage],
          });
          return assetId;
        };
        const primaryId = await saveImage(
          imagePath,
          phase === "storyboard" ? "九宫格分镜.png" : `${selectedShot.title}-参考图.png`,
          imageStream.width,
          imageStream.height,
        );
        const cellAssetIds: Record<string, string> = {};
        if (phase === "storyboard") {
          const cropPaths = shots.map((_, index) => resolve(tempDir, `shot-${index + 1}.png`));
          const dimensions = await cropStoryboardGrid(imagePath, cropPaths);
          for (const [index, shot] of shots.entries()) {
            const cropPath = cropPaths[index];
            if (!cropPath) throw new Error("STORYBOARD_GRID_CROP_MISSING");
            cellAssetIds[shot.id] = await saveImage(
              cropPath,
              `${shot.title}-参考图.png`,
              dimensions.width,
              dimensions.height,
            );
          }
        } else cellAssetIds[selectedShot.id] = primaryId;
        stage.completedAt = new Date().toISOString();
        const values = { ...job.values, generatedAssetId: primaryId, cellAssetIds: JSON.stringify(cellAssetIds) };
        context.change(job.id, {
          status: "succeeded",
          stage: phase === "storyboard" ? "九宫格分镜稿件已生成" : "分镜参考图已生成",
          progress: 100,
          values,
          provenance: [stage],
          result: {
            kind: `script-remix-next-${phase}`,
            title: job.title,
            summary: phase === "storyboard" ? `已生成并切分 ${shots.length} 个有效分镜。` : "单格参考图已生成。",
            artifacts,
            data: { values, generatedAt: new Date().toISOString(), mock: false },
          },
        });
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
  };
}

export const scriptRemixNextJob = createScriptRemixNextJob();
