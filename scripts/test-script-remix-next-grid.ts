import { Buffer } from "node:buffer";
import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { AccountStore } from "../server/accounts/account-store";
import { SqliteJobStore } from "../server/jobs/sqlite-job-store";
import { cropStoryboardGrid, probeMedia } from "../server/media/ffmpeg";
import { type AihubmixImageResult, aihubmix } from "../server/providers/aihubmix";
import { buildStoryboardGridPrompt } from "../server/script-remix-next/model";
import { ossutils } from "../server/storage/ossutils";
import type { ScriptRemixNextShot } from "../shared/script-remix-next/workflow";

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function resultBytes(result: AihubmixImageResult) {
  if (result.b64Json) return new Uint8Array(Buffer.from(result.b64Json, "base64"));
  if (!result.url) throw new Error("IMAGE_RESULT_EMPTY");
  const response = await fetch(result.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`IMAGE_RESULT_DOWNLOAD_${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

const projectId = argument("project");
const assetId = argument("asset");
if (!projectId || !assetId) throw new Error("Usage: --project=<job-id> --asset=<reference-asset-id>");

const store = new SqliteJobStore();
const accounts = new AccountStore();
try {
  const project = store.get(projectId);
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  const asset = accounts.getOwnedAsset(project.ownerUserId, assetId);
  if (!asset) throw new Error("REFERENCE_ASSET_NOT_FOUND");
  const shots = JSON.parse(project.values.shots || "[]") as ScriptRemixNextShot[];
  if (!shots.length) throw new Error("PROJECT_SHOTS_EMPTY");

  const outputDir = resolve("artifacts/api-tests/script-remix-next-storyboard");
  await mkdir(outputDir, { recursive: true });
  const referencePath = resolve(outputDir, `reference-${basename(asset.storageKey)}`);
  await ossutils.downloadLibraryFile(asset.storageKey, referencePath);
  const prompt = buildStoryboardGridPrompt({
    shots,
    productName: project.values.productName || asset.originalName,
    portraitName: project.values.portraitName,
  });
  const [result] = await aihubmix.editImages({
    prompt,
    images: [
      {
        bytes: new Uint8Array(await Bun.file(referencePath).arrayBuffer()),
        mimeType: asset.mimeType,
        name: asset.originalName,
      },
    ],
    model: "gpt-image-2",
    size: "1024x1536",
    count: 1,
    quality: "high",
  });
  if (!result) throw new Error("IMAGE_RESULT_EMPTY");
  const gridPath = resolve(outputDir, "high-quality-grid.png");
  await Bun.write(gridPath, await resultBytes(result));
  const cellPaths = shots.slice(0, 9).map((_, index) => resolve(outputDir, `cell-${index + 1}.png`));
  const cellSize = await cropStoryboardGrid(gridPath, cellPaths);
  const media = await probeMedia(gridPath);
  await Bun.write(
    resolve(outputDir, "high-quality-grid-report.json"),
    `${JSON.stringify(
      {
        model: "gpt-image-2",
        quality: "high",
        projectId,
        assetId,
        prompt,
        grid: {
          path: gridPath,
          width: media.streams[0]?.width,
          height: media.streams[0]?.height,
          bytes: Bun.file(gridPath).size,
        },
        cells: { count: cellPaths.length, ...cellSize, paths: cellPaths },
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  console.log(JSON.stringify({ gridPath, cellPaths, cellSize }, null, 2));
} finally {
  accounts.close();
  store.close();
}
