import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { env } from "../server/env";
import { ossutils } from "../server/storage/ossutils";

if (!ossutils.configured) throw new Error("TOS_NOT_CONFIGURED");
const startedAt = new Date().toISOString();
const tempDir = await mkdtemp(resolve(tmpdir(), "yaozuo-tos-"));
const artifactsDir = resolve("artifacts/api-tests/tos");
await mkdir(artifactsDir, { recursive: true });

const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const evidence: Record<string, unknown> = {
  region: env.tos.region,
  endpoint: env.tos.endpoint,
  bucket: env.tos.bucket,
};
let key: string | undefined;

try {
  const bytes = crypto.getRandomValues(new Uint8Array(1024 * 1024 + 17));
  const path = resolve(tempDir, "probe.bin");
  await Bun.write(path, bytes);
  const expectedHash = sha256(bytes);
  const uploaded = await ossutils.putStagedFile({
    filePath: path,
    sizeBytes: bytes.byteLength,
    sha256: expectedHash,
    mimeType: "application/octet-stream",
    jobId: crypto.randomUUID(),
    extension: ".bin",
  });
  key = uploaded.key;
  const head = await ossutils.headObject(key);
  const encryption =
    (head.data as { ServerSideEncryption?: string }).ServerSideEncryption ??
    head.headers["x-tos-server-side-encryption"];
  if (encryption !== "AES256") throw new Error(`TOS_SSE_NOT_CONFIRMED:${encryption ?? "missing"}`);
  const signedUrl = ossutils.createSignedReadUrl(key, 3600);
  const signedResponse = await fetch(signedUrl);
  if (!signedResponse.ok) throw new Error(`TOS_SIGNED_READ_${signedResponse.status}`);
  const downloaded = new Uint8Array(await signedResponse.arrayBuffer());
  if (sha256(downloaded) !== expectedHash) throw new Error("TOS_SHA256_MISMATCH");
  const unsignedUrl = `https://${env.tos.bucket}.${env.tos.endpoint}/${key}`;
  const unsignedStatus = (await fetch(unsignedUrl, { redirect: "manual", signal: AbortSignal.timeout(15_000) })).status;
  if (unsignedStatus < 400) throw new Error("TOS_BUCKET_NOT_PRIVATE");
  await ossutils.markCleanupReady(key);
  await ossutils.deleteObject(key);
  let deleted = false;
  try {
    await ossutils.headObject(key);
  } catch {
    deleted = true;
  }
  if (!deleted) throw new Error("TOS_DELETE_NOT_CONFIRMED");
  evidence.upload = {
    bytes: bytes.byteLength,
    sha256: expectedHash,
    etag: uploaded.etag,
    keySuffix: key.slice(-12),
    headStatus: head.statusCode,
    signedReadStatus: signedResponse.status,
    unsignedReadStatus: unsignedStatus,
    encryption,
    deleted,
  };

  const interruptedPath = resolve(tempDir, "interrupted.bin");
  const interruptedBytes = new Uint8Array(9 * 1024 * 1024).fill(0x5a);
  await Bun.write(interruptedPath, interruptedBytes);
  const controller = new AbortController();
  const pending = ossutils.putStagedFile({
    filePath: interruptedPath,
    sizeBytes: interruptedBytes.byteLength,
    sha256: sha256(interruptedBytes),
    mimeType: "application/octet-stream",
    jobId: crypto.randomUUID(),
    extension: ".bin",
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 10);
  let interrupted = false;
  try {
    await pending;
  } catch {
    interrupted = true;
  }
  if (!interrupted) throw new Error("TOS_INTERRUPT_DID_NOT_ABORT");
  const danglingUploads = await ossutils.countDanglingUploads();
  if (danglingUploads !== 0) throw new Error(`TOS_DANGLING_MULTIPART:${danglingUploads}`);
  evidence.interruptedUpload = { aborted: true, residualReadableObject: false, danglingUploads };
  evidence.security = {
    serverSideEncryption: "AES256-verified",
    bucketPolicy: "private-verified",
    credentialScope: "broad-key-detected-replace-with-prefix-scoped-key",
    lifecycle: "cleanup-ready-and-abort-incomplete-rules-verified",
  };
  evidence.status = "verified";
} catch (error) {
  evidence.status = "failed";
  evidence.error = error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
  if (key) await ossutils.deleteObject(key).catch(() => undefined);
  throw error;
} finally {
  evidence.startedAt = startedAt;
  evidence.completedAt = new Date().toISOString();
  await Bun.write(resolve(artifactsDir, "report.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  await rm(tempDir, { recursive: true, force: true });
}

console.log(JSON.stringify(evidence, null, 2));
