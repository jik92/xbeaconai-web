import { resolve } from "node:path";
import portraitRecords from "../public/portraits.json";
import { systemPortraitMedia, systemSceneMedia } from "../shared/media/system-media";
import { sceneCatalog } from "../shared/scenes/scene-catalog";

export interface SystemMediaManifestEntry {
  storageKey: string;
  mimeType: "image/png" | "image/jpeg";
  sourceUrl?: string;
  localPath?: string;
}

interface SourceBytes {
  bytes: Uint8Array;
  mimeType: string;
}

interface SyncSystemMediaInput {
  apply: boolean;
  entries: readonly SystemMediaManifestEntry[];
  concurrency?: number;
  head: (key: string) => Promise<boolean>;
  fetchBytes: (entry: SystemMediaManifestEntry) => Promise<SourceBytes>;
  uploadBytes: (entry: SystemMediaManifestEntry, bytes: Uint8Array) => Promise<void>;
}

export function systemMediaManifest(): SystemMediaManifestEntry[] {
  const portraits = portraitRecords.map((portrait) => ({
    storageKey: systemPortraitMedia(portrait.index).storageKey,
    mimeType: "image/png" as const,
    sourceUrl: portrait.source_url,
  }));
  const scenes = sceneCatalog.map((scene) => ({
    storageKey: systemSceneMedia(scene.id).storageKey,
    mimeType: "image/jpeg" as const,
    localPath: resolve(import.meta.dir, "..", `public${scene.localPath}`),
  }));
  return [...portraits, ...scenes];
}

async function mapConcurrent<T>(items: readonly T[], concurrency: number, task: (item: T) => Promise<void>) {
  let index = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      if (item) await task(item);
    }
  });
  await Promise.all(workers);
}

export async function syncSystemMedia(input: SyncSystemMediaInput) {
  const missing: SystemMediaManifestEntry[] = [];
  await mapConcurrent(input.entries, input.concurrency ?? 8, async (entry) => {
    if (!(await input.head(entry.storageKey))) missing.push(entry);
  });
  missing.sort((left, right) => left.storageKey.localeCompare(right.storageKey));

  if (!input.apply)
    return {
      checked: input.entries.length,
      uploaded: 0,
      missing: missing.map((entry) => entry.storageKey),
    };

  await mapConcurrent(missing, input.concurrency ?? 8, async (entry) => {
    const source = await input.fetchBytes(entry);
    const mimeType = source.mimeType.split(";", 1)[0]?.trim().toLowerCase();
    if (mimeType !== entry.mimeType)
      throw new Error(`SYSTEM_MEDIA_MIME_MISMATCH:${entry.storageKey}:${mimeType || "missing"}`);
    if (!source.bytes.byteLength) throw new Error(`SYSTEM_MEDIA_EMPTY:${entry.storageKey}`);
    await input.uploadBytes(entry, source.bytes);
  });

  const remaining: string[] = [];
  await mapConcurrent(input.entries, input.concurrency ?? 8, async (entry) => {
    if (!(await input.head(entry.storageKey))) remaining.push(entry.storageKey);
  });
  remaining.sort();
  return {
    checked: input.entries.length,
    uploaded: missing.length - remaining.length,
    missing: remaining,
  };
}

function tosStatusCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const record = error as { statusCode?: unknown; status?: unknown };
  const value = record.statusCode ?? record.status;
  return typeof value === "number" ? value : Number(value);
}

async function sourceBytes(entry: SystemMediaManifestEntry): Promise<SourceBytes> {
  if (entry.localPath) {
    const file = Bun.file(entry.localPath);
    if (!(await file.exists())) throw new Error(`SYSTEM_MEDIA_SOURCE_MISSING:${entry.storageKey}`);
    return { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type };
  }
  if (!entry.sourceUrl) throw new Error(`SYSTEM_MEDIA_SOURCE_MISSING:${entry.storageKey}`);
  const response = await fetch(entry.sourceUrl, { redirect: "follow" });
  if (!response.ok) throw new Error(`SYSTEM_MEDIA_SOURCE_HTTP:${entry.storageKey}:${response.status}`);
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mimeType: response.headers.get("content-type") ?? "",
  };
}

async function main() {
  const { ossutils } = await import("../server/storage/ossutils");
  const apply = process.argv.includes("--apply");
  const entries = systemMediaManifest();
  const result = await syncSystemMedia({
    apply,
    entries,
    concurrency: Number(process.env.SYSTEM_MEDIA_SYNC_CONCURRENCY ?? 8),
    head: async (key) => {
      try {
        await ossutils.headObject(key);
        return true;
      } catch (error) {
        if (tosStatusCode(error) === 404) return false;
        throw error;
      }
    },
    fetchBytes: sourceBytes,
    uploadBytes: async (entry, bytes) => {
      try {
        await ossutils.putLibraryBytesIfAbsent({ bytes, key: entry.storageKey, mimeType: entry.mimeType });
      } catch (error) {
        if (tosStatusCode(error) !== 409 && tosStatusCode(error) !== 412) throw error;
      }
    },
  });
  console.log(JSON.stringify({ mode: apply ? "apply" : "check", ...result }, null, 2));
  if (result.missing.length) process.exitCode = 1;
}

if (import.meta.main)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
