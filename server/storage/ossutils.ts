import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import TosClient from "@volcengine/tos-sdk";
import { providerCredentials } from "../byok/credential-store";
import { env } from "../env";

export interface PutStagedFileInput {
  filePath: string;
  sizeBytes: number;
  sha256: string;
  mimeType: string;
  jobId: string;
  extension: string;
  signal?: AbortSignal;
}

export interface TosObjectRef {
  key: string;
  versionId?: string;
}

export interface LibraryObjectUploadClient {
  putObjectFromFile(input: {
    bucket: string;
    key: string;
    filePath: string;
    contentLength: number;
    acl: (typeof TosClient.ACLType)["ACLPrivate"];
    contentType: string;
    serverSideEncryption: string;
    progress?: (percent: number) => void;
  }): Promise<unknown>;
  headObject(input: { bucket: string; key: string }): Promise<{ headers: Record<string, string | undefined> }>;
  deleteObject(input: { bucket: string; key: string }): Promise<unknown>;
}

export async function putLibraryObject(
  client: LibraryObjectUploadClient,
  input: {
    bucket: string;
    filePath: string;
    key: string;
    mimeType: string;
    sizeBytes: number;
    onProgress?: (percent: number) => void;
    signal?: AbortSignal;
  },
) {
  if (input.signal?.aborted) throw new Error("TOS_UPLOAD_ABORTED");
  try {
    await client.putObjectFromFile({
      bucket: input.bucket,
      key: input.key,
      filePath: input.filePath,
      contentLength: input.sizeBytes,
      acl: TosClient.ACLType.ACLPrivate,
      contentType: input.mimeType,
      serverSideEncryption: "AES256",
      progress: (percent) => input.onProgress?.(percent),
    });
    if (input.signal?.aborted) throw new Error("TOS_UPLOAD_ABORTED");
    const head = await client.headObject({ bucket: input.bucket, key: input.key });
    const uploadedSize = Number(head.headers["content-length"] ?? -1);
    if (uploadedSize !== input.sizeBytes)
      throw new Error(`TOS 上传完成后的文件大小校验失败（期望 ${input.sizeBytes}，实际 ${uploadedSize}）`);
    if (head.headers["x-tos-server-side-encryption"] !== "AES256") throw new Error("TOS 上传对象未启用 AES256 加密");
  } catch (error) {
    await client.deleteObject({ bucket: input.bucket, key: input.key }).catch(() => undefined);
    throw error;
  }
}

const MAX_ACTIVE_UPLOAD_BYTES = 500 * 1024 * 1024;
const MAX_ACTIVE_UPLOADS = 2;
const CURL_UPLOAD_PART_SIZE = 16 * 1024 * 1024;

export function parseCurlUploadResponse(output: string) {
  const status = Number(/CURL_STATUS:(\d{3})/.exec(output)?.[1] ?? 0);
  const eTag = /(?:^|\n)etag:\s*([^\r\n]+)/i.exec(output)?.[1]?.trim();
  return { status, eTag };
}

export function parseCurlProgress(output: string) {
  const matches = [...output.matchAll(/(\d+(?:\.\d+)?)%/g)];
  const lastPercent = matches.at(-1)?.[1];
  return lastPercent === undefined ? undefined : Math.max(0, Math.min(100, Number(lastPercent)));
}

export function tosPaginationMarkers(input: { keyMarker?: string; versionIdMarker?: string; uploadIdMarker?: string }) {
  return {
    ...(input.keyMarker ? { keyMarker: input.keyMarker } : {}),
    ...(input.versionIdMarker ? { versionIdMarker: input.versionIdMarker } : {}),
    ...(input.uploadIdMarker ? { uploadIdMarker: input.uploadIdMarker } : {}),
  };
}

class WeightedUploadGate {
  private activeBytes = 0;
  private activeCount = 0;
  private readonly waiting: Array<() => void> = [];

  async acquire(bytes: number) {
    while (this.activeCount >= MAX_ACTIVE_UPLOADS || this.activeBytes + bytes > MAX_ACTIVE_UPLOAD_BYTES) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.activeCount += 1;
    this.activeBytes += bytes;
    return () => {
      this.activeCount -= 1;
      this.activeBytes -= bytes;
      this.waiting.splice(0).forEach((resolve) => {
        resolve();
      });
    };
  }
}

const uploadGate = new WeightedUploadGate();

export class OssUtils {
  private serverClient?: TosClient;
  private publicClient?: TosClient;
  private credentialFingerprint = "";

  private credentials() {
    return {
      accessKeyId: providerCredentials.get("TOS_ACCESS_KEY_ID") ?? "",
      accessKeySecret: providerCredentials.get("TOS_SECRET_ACCESS_KEY") ?? "",
    };
  }

  get configured() {
    const credentials = this.credentials();
    return Boolean(credentials.accessKeyId && credentials.accessKeySecret);
  }

  private ready(kind: "server" | "public" = "server") {
    const credentials = this.credentials();
    if (!credentials.accessKeyId || !credentials.accessKeySecret) throw new Error("TOS_NOT_CONFIGURED");
    const fingerprint = `${credentials.accessKeyId}\0${credentials.accessKeySecret}`;
    if (fingerprint !== this.credentialFingerprint) {
      this.serverClient = undefined;
      this.publicClient = undefined;
      this.credentialFingerprint = fingerprint;
    }
    const existing = kind === "server" ? this.serverClient : this.publicClient;
    if (existing) return existing;
    const client = new TosClient({
      ...credentials,
      region: env.tos.region,
      endpoint: kind === "server" ? env.tos.serverEndpoint : env.tos.publicEndpoint,
      bucket: env.tos.bucket,
      secure: true,
      requestTimeout: 10 * 60_000,
      connectionTimeout: 15_000,
      maxRetryCount: 2,
    });
    if (kind === "server") this.serverClient = client;
    else this.publicClient = client;
    return client;
  }

  private async abortDanglingUploads(key: string) {
    let keyMarker: string | undefined;
    let uploadIdMarker: string | undefined;
    while (true) {
      const response = await this.ready().listMultipartUploads({
        bucket: env.tos.bucket,
        prefix: key,
        maxUploads: 1000,
        ...tosPaginationMarkers({ keyMarker, uploadIdMarker }),
      });
      const tasks: Promise<unknown>[] = [];
      for (const upload of response.data.Uploads ?? []) {
        if (upload.Key !== key || !upload.UploadId) continue;
        tasks.push(this.ready().abortMultipartUpload({ bucket: env.tos.bucket, key, uploadId: upload.UploadId }));
      }
      const results = await Promise.allSettled(tasks);
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      if (!response.data.IsTruncated) return;
      keyMarker = response.data.NextKeyMarker;
      uploadIdMarker = response.data.NextUploadIdMarker;
      if (!keyMarker && !uploadIdMarker) throw new Error(`TOS_MULTIPART_PAGINATION_INVALID:${key}`);
    }
  }

  private async abortMultipartUploadsByPrefix(prefix: string) {
    let keyMarker: string | undefined;
    let uploadIdMarker: string | undefined;
    let aborted = 0;
    while (true) {
      const response = await this.ready().listMultipartUploads({
        bucket: env.tos.bucket,
        prefix,
        maxUploads: 1000,
        ...tosPaginationMarkers({ keyMarker, uploadIdMarker }),
      });
      const uploads = response.data.Uploads ?? [];
      for (const upload of uploads) {
        if (!upload.Key || !upload.UploadId) continue;
        await this.ready().abortMultipartUpload({
          bucket: env.tos.bucket,
          key: upload.Key,
          uploadId: upload.UploadId,
        });
        aborted += 1;
      }
      if (!response.data.IsTruncated) return aborted;
      keyMarker = response.data.NextKeyMarker;
      uploadIdMarker = response.data.NextUploadIdMarker;
      if (!keyMarker && !uploadIdMarker) throw new Error(`TOS_MULTIPART_PAGINATION_INVALID:${prefix}`);
    }
  }

  async ensureDirectory(prefix: string) {
    if (!this.configured) return;
    const key = `${prefix.replace(/^\/+/, "").replace(/\/*$/, "")}/`;
    await this.ready().putObject({
      bucket: env.tos.bucket,
      key,
      body: Buffer.alloc(0),
      acl: TosClient.ACLType.ACLPrivate,
      contentType: "application/x-directory",
    });
  }

  async putLibraryFile(input: {
    filePath: string;
    key: string;
    mimeType: string;
    sizeBytes: number;
    onProgress?: (percent: number) => void;
    signal?: AbortSignal;
  }) {
    if (!this.configured) return;
    if (input.signal?.aborted) throw new Error("TOS_UPLOAD_ABORTED");
    const release = await uploadGate.acquire(input.sizeBytes);
    const key = input.key.replace(/^\/+/, "");
    try {
      await this.abortDanglingUploads(key);
      await putLibraryObject(this.ready(), {
        bucket: env.tos.bucket,
        key,
        filePath: input.filePath,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        onProgress: input.onProgress,
        signal: input.signal,
      });
    } finally {
      release();
    }
  }

  async putLibraryFileViaCurl(input: {
    filePath: string;
    key: string;
    mimeType: string;
    sizeBytes: number;
    onProgress?: (percent: number) => void;
    signal?: AbortSignal;
  }) {
    if (!this.configured) return;
    if (!Bun.which("curl")) throw new Error("CURL_NOT_INSTALLED: 视频提取上传需要 curl");
    if (input.signal?.aborted) throw new Error("TOS_UPLOAD_ABORTED");
    const release = await uploadGate.acquire(input.sizeBytes);
    const key = input.key.replace(/^\/+/, "");
    const partDir = await mkdtemp(resolve(tmpdir(), "yaozuo-tos-upload-"));
    let uploadId: string | undefined;
    try {
      const created = await this.ready().createMultipartUpload({
        bucket: env.tos.bucket,
        key,
        acl: TosClient.ACLType.ACLPrivate,
        contentType: input.mimeType,
        serverSideEncryption: "AES256",
      });
      uploadId = created.data.UploadId;
      const parts: Array<{ partNumber: number; eTag: string }> = [];
      const source = Bun.file(input.filePath);
      for (let offset = 0, partNumber = 1; offset < input.sizeBytes; offset += CURL_UPLOAD_PART_SIZE, partNumber += 1) {
        if (input.signal?.aborted) throw new Error("TOS_UPLOAD_ABORTED");
        const end = Math.min(input.sizeBytes, offset + CURL_UPLOAD_PART_SIZE);
        const partSize = end - offset;
        const partPath = resolve(partDir, `part-${partNumber}`);
        await Bun.write(partPath, await source.slice(offset, end).arrayBuffer());
        if (Bun.file(partPath).size !== partSize) throw new Error(`TOS 临时分片大小校验失败（分片 ${partNumber}）`);
        const signedUrl = this.ready().getPreSignedUrl({
          bucket: env.tos.bucket,
          key,
          method: "PUT",
          expires: 15 * 60,
          query: { uploadId, partNumber: String(partNumber) },
        });
        const process = Bun.spawn(
          [
            "curl",
            "--progress-bar",
            "--connect-timeout",
            "15",
            "--max-time",
            "600",
            "--retry",
            "2",
            "--retry-all-errors",
            "--dump-header",
            "-",
            "--output",
            "/dev/null",
            "--write-out",
            "\nCURL_STATUS:%{http_code}",
            "--upload-file",
            partPath,
            signedUrl,
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
        const abort = () => process.kill();
        input.signal?.addEventListener("abort", abort, { once: true });
        const progressTask = (async () => {
          const reader = process.stderr.getReader();
          const decoder = new TextDecoder();
          let pending = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            pending = `${pending}${decoder.decode(value, { stream: true })}`.slice(-512);
            const partPercent = parseCurlProgress(pending);
            if (partPercent !== undefined)
              input.onProgress?.((offset + (partPercent / 100) * partSize) / input.sizeBytes);
          }
        })();
        const [exitCode, output] = await Promise.all([
          process.exited,
          new Response(process.stdout).text(),
          progressTask,
        ]);
        input.signal?.removeEventListener("abort", abort);
        const response = parseCurlUploadResponse(output);
        if (exitCode !== 0 || response.status < 200 || response.status >= 300 || !response.eTag)
          throw new Error(`TOS 分片上传失败（curl=${exitCode}, HTTP=${response.status || "unknown"}）`);
        parts.push({ partNumber, eTag: response.eTag });
        input.onProgress?.(end / input.sizeBytes);
      }
      await this.ready().completeMultipartUpload({ bucket: env.tos.bucket, key, uploadId, parts });
      const head = await this.ready().headObject({ bucket: env.tos.bucket, key });
      const uploadedSize = Number(head.headers["content-length"] ?? -1);
      if (uploadedSize !== input.sizeBytes)
        throw new Error(`TOS 上传完成后的文件大小校验失败（期望 ${input.sizeBytes}，实际 ${uploadedSize}）`);
      if (head.headers["x-tos-server-side-encryption"] !== "AES256") throw new Error("TOS 上传对象未启用 AES256 加密");
    } catch (error) {
      if (uploadId)
        await this.ready()
          .abortMultipartUpload({ bucket: env.tos.bucket, key, uploadId })
          .catch(() => undefined);
      await this.ready()
        .deleteObject({ bucket: env.tos.bucket, key })
        .catch(() => undefined);
      throw error;
    } finally {
      await rm(partDir, { recursive: true, force: true });
      release();
    }
  }

  async putLibraryBytes(input: { bytes: Uint8Array; key: string; mimeType: string }) {
    await this.ready().putObject({
      bucket: env.tos.bucket,
      key: input.key.replace(/^\/+/, ""),
      body: Buffer.from(input.bytes),
      acl: TosClient.ACLType.ACLPrivate,
      contentType: input.mimeType,
      serverSideEncryption: "AES256",
    });
  }

  async putLibraryBytesIfAbsent(input: { bytes: Uint8Array; key: string; mimeType: string }) {
    await this.ready().putObject({
      bucket: env.tos.bucket,
      key: input.key.replace(/^\/+/, ""),
      body: Buffer.from(input.bytes),
      acl: TosClient.ACLType.ACLPrivate,
      contentType: input.mimeType,
      serverSideEncryption: "AES256",
      forbidOverwrite: true,
    });
  }

  async downloadLibraryFile(key: string, filePath: string) {
    await this.ready().downloadFile({
      bucket: env.tos.bucket,
      key: key.replace(/^\/+/, ""),
      filePath,
      partSize: 8 * 1024 * 1024,
      taskNum: 2,
    });
  }

  createSignedUploadUrl(key: string, expiresSeconds = 15 * 60) {
    return this.ready("public").getPreSignedUrl({
      bucket: env.tos.bucket,
      key: key.replace(/^\/+/, ""),
      method: "PUT",
      expires: expiresSeconds,
    });
  }

  async putStagedFile(input: PutStagedFileInput) {
    if (input.signal?.aborted) throw new Error("TOS_UPLOAD_ABORTED");
    const release = await uploadGate.acquire(input.sizeBytes);
    const safeExtension = input.extension.replace(/[^a-zA-Z0-9.]/g, "").slice(0, 10) || ".bin";
    const key = `seedance-staging/active/${input.jobId}/${crypto.randomUUID()}${safeExtension.startsWith(".") ? safeExtension : `.${safeExtension}`}`;
    let uploadId: string | undefined;
    const cancelSource = TosClient.CancelToken.source();
    const abort = () => cancelSource.cancel("upload aborted");
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await this.ready().uploadFile({
        bucket: env.tos.bucket,
        key,
        file: input.filePath,
        partSize: 8 * 1024 * 1024,
        taskNum: 2,
        acl: TosClient.ACLType.ACLPrivate,
        contentType: input.mimeType,
        serverSideEncryption: "AES256",
        meta: { sha256: input.sha256, "cleanup-ready": "false" },
        cancelToken: cancelSource.token,
        uploadEventChange: (event) => {
          uploadId = event.uploadId || uploadId;
        },
      });
      return { key, etag: response.data.ETag };
    } catch (error) {
      if (uploadId)
        await this.ready()
          .abortMultipartUpload({ bucket: env.tos.bucket, key, uploadId })
          .catch(() => undefined);
      await this.abortDanglingUploads(key).catch(() => undefined);
      await this.ready()
        .deleteObject({ bucket: env.tos.bucket, key })
        .catch(() => undefined);
      throw error;
    } finally {
      input.signal?.removeEventListener("abort", abort);
      release();
    }
  }

  createSignedReadUrl(key: string, expiresSeconds = 24 * 60 * 60) {
    return this.ready("public").getPreSignedUrl({
      bucket: env.tos.bucket,
      key,
      method: "GET",
      expires: expiresSeconds,
    });
  }

  headObject(key: string) {
    return this.ready().headObject({ bucket: env.tos.bucket, key });
  }
  async objectExists(key: string) {
    try {
      await this.headObject(key);
      return true;
    } catch (error) {
      const statusCode =
        error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : undefined;
      if (statusCode === 404) return false;
      throw error;
    }
  }
  async markCleanupReady(key: string) {
    await this.ready().putObjectTagging({
      bucket: env.tos.bucket,
      key,
      tagSet: { Tags: [{ Key: "cleanup-ready", Value: "true" }] },
    });
  }
  async deleteObject(key: string) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await this.ready().deleteObject({ bucket: env.tos.bucket, key });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await Bun.sleep(300 * 2 ** attempt);
      }
    }
    throw lastError;
  }
  async deleteMany(keys: string[]) {
    await Promise.allSettled(keys.map((key) => this.deleteObject(key)));
  }
  private async listVersionedObjectRefs(prefix: string) {
    const refs: TosObjectRef[] = [];
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    while (true) {
      const response = await this.ready().listObjectVersions({
        bucket: env.tos.bucket,
        prefix,
        maxKeys: 1000,
        ...tosPaginationMarkers({ keyMarker, versionIdMarker }),
      });
      refs.push(
        ...(response.data.Versions ?? []).map((item) => ({ key: item.Key, versionId: item.VersionId })),
        ...(response.data.DeleteMarkers ?? []).map((item) => ({ key: item.Key, versionId: item.VersionId })),
      );
      if (!response.data.IsTruncated) return refs;
      keyMarker = response.data.NextKeyMarker;
      versionIdMarker = response.data.NextVersionIdMarker;
      if (!keyMarker && !versionIdMarker) throw new Error(`TOS_VERSION_PAGINATION_INVALID:${prefix}`);
    }
  }
  private async deleteObjectRefs(refs: TosObjectRef[]) {
    let deleted = 0;
    for (let offset = 0; offset < refs.length; offset += 1000) {
      const batch = refs.slice(offset, offset + 1000);
      const response = await this.ready().deleteMultiObjects({
        bucket: env.tos.bucket,
        objects: batch,
      });
      const failures = response.data.Error ?? [];
      if (failures.length)
        throw new Error(`TOS_DELETE_FAILED:${failures.map((item) => `${item.Key}:${item.Code}`).join(",")}`);
      deleted += batch.length;
    }
    return deleted;
  }
  async deleteKeysPermanently(keys: string[]) {
    const uniqueKeys = [...new Set(keys.filter(Boolean))];
    let deleted = 0;
    for (const key of uniqueKeys) {
      await this.abortDanglingUploads(key);
      while (true) {
        const versioned = (await this.listVersionedObjectRefs(key)).filter((item) => item.key === key);
        if (versioned.length) {
          deleted += await this.deleteObjectRefs(versioned);
          continue;
        }
        const current = await this.ready().listObjectsType2({
          bucket: env.tos.bucket,
          prefix: key,
          maxKeys: 1,
          listOnlyOnce: true,
        });
        if (!(current.data.Contents ?? []).some((item) => item.Key === key)) break;
        await this.deleteObject(key);
        deleted += 1;
      }
      const remainingUploads = await this.ready().listMultipartUploads({
        bucket: env.tos.bucket,
        prefix: key,
        maxUploads: 1,
      });
      if ((remainingUploads.data.Uploads ?? []).some((upload) => upload.Key === key))
        throw new Error(`TOS_KEY_MULTIPART_NOT_EMPTY:${key}`);
    }
    return deleted;
  }
  async deletePrefixPermanently(prefix: string) {
    let deleted = await this.abortMultipartUploadsByPrefix(prefix);
    while (true) {
      const refs = await this.listVersionedObjectRefs(prefix);
      if (!refs.length) break;
      deleted += await this.deleteObjectRefs(refs);
    }
    while (true) {
      const remaining = await this.ready().listObjectsType2({
        bucket: env.tos.bucket,
        prefix,
        maxKeys: 1000,
        listOnlyOnce: true,
      });
      const keys = (remaining.data.Contents ?? []).map((item) => item.Key);
      if (!keys.length) break;
      deleted += await this.deleteKeysPermanently(keys);
    }
    const verification = await this.ready().listObjectsType2({
      bucket: env.tos.bucket,
      prefix,
      maxKeys: 1,
      listOnlyOnce: true,
    });
    if ((verification.data.Contents ?? []).length) throw new Error(`TOS_PREFIX_NOT_EMPTY:${prefix}`);
    const remainingUploads = await this.countDanglingUploads(prefix);
    if (remainingUploads) throw new Error(`TOS_PREFIX_MULTIPART_NOT_EMPTY:${prefix}`);
    return deleted;
  }
  async countDanglingUploads(prefix = "seedance-staging/") {
    const response = await this.ready().listMultipartUploads({ bucket: env.tos.bucket, prefix });
    return (response.data.Uploads ?? []).length;
  }
}

export const ossutils = new OssUtils();
