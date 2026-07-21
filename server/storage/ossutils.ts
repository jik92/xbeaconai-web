import { Buffer } from "node:buffer";
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

const MAX_ACTIVE_UPLOAD_BYTES = 500 * 1024 * 1024;
const MAX_ACTIVE_UPLOADS = 2;

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
      this.waiting.splice(0).forEach((resolve) => resolve());
    };
  }
}

const uploadGate = new WeightedUploadGate();

export class OssUtils {
  private client?: TosClient;
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

  private ready() {
    const credentials = this.credentials();
    if (!credentials.accessKeyId || !credentials.accessKeySecret) throw new Error("TOS_NOT_CONFIGURED");
    const fingerprint = `${credentials.accessKeyId}\0${credentials.accessKeySecret}`;
    if (this.client && fingerprint === this.credentialFingerprint) return this.client;
    this.client = new TosClient({
      ...credentials,
      region: env.tos.region,
      endpoint: env.tos.endpoint,
      bucket: env.tos.bucket,
      secure: true,
      requestTimeout: 10 * 60_000,
      connectionTimeout: 15_000,
      maxRetryCount: 2,
    });
    this.credentialFingerprint = fingerprint;
    return this.client;
  }

  private async abortDanglingUploads(key: string) {
    const response = await this.ready().listMultipartUploads({ bucket: env.tos.bucket, prefix: key });
    await Promise.allSettled(
      (response.data.Uploads ?? [])
        .filter((upload) => upload.Key === key && upload.UploadId)
        .map((upload) =>
          this.ready().abortMultipartUpload({ bucket: env.tos.bucket, key, uploadId: upload.UploadId! }),
        ),
    );
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
    let uploadId: string | undefined;
    const cancelSource = TosClient.CancelToken.source();
    const abort = () => cancelSource.cancel("upload aborted");
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      await this.ready().uploadFile({
        bucket: env.tos.bucket,
        key,
        file: input.filePath,
        partSize: 8 * 1024 * 1024,
        taskNum: 2,
        acl: TosClient.ACLType.ACLPrivate,
        contentType: input.mimeType,
        serverSideEncryption: "AES256",
        progress: (percent) => input.onProgress?.(percent),
        uploadEventChange: (event) => {
          uploadId = event.uploadId || uploadId;
        },
        cancelToken: cancelSource.token,
      });
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
    return this.ready().getPreSignedUrl({
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
    return this.ready().getPreSignedUrl({ bucket: env.tos.bucket, key, method: "GET", expires: expiresSeconds });
  }

  headObject(key: string) {
    return this.ready().headObject({ bucket: env.tos.bucket, key });
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
  async countDanglingUploads(prefix = "seedance-staging/") {
    const response = await this.ready().listMultipartUploads({ bucket: env.tos.bucket, prefix });
    return (response.data.Uploads ?? []).length;
  }
}

export const ossutils = new OssUtils();
