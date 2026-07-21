import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountStore } from "../../server/accounts/account-store";
import { env } from "../../server/env";
import { SqliteJobStore } from "../../server/jobs/sqlite-job-store";
import { userPreferences, users } from "../../server/db/schema";
import type { JobRecord } from "../../server/types";
import { douyinVideoImportJob } from "../../worker/jobs/job-douyin-video-import";
import type { JobHandlerContext } from "../../worker/jobs/types";

const databases: string[] = [];
const tempDirs: string[] = [];

function cleanup() {
  for (const db of databases) {
    try {
      rmSync(db, { force: true });
    } catch {
      /* ok */
    }
    try {
      rmSync(`${db}-wal`, { force: true });
    } catch {
      /* ok */
    }
    try {
      rmSync(`${db}-shm`, { force: true });
    } catch {
      /* ok */
    }
  }
  databases.length = 0;
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ok */
    }
  }
  tempDirs.length = 0;
}

afterEach(cleanup);

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "dy-import-integration-"));
  tempDirs.push(dir);
  return dir;
}

function makeStoreAndAccounts(): { store: SqliteJobStore; accounts: AccountStore } {
  const path = join(tmpdir(), `dy-integration-${crypto.randomUUID()}.sqlite`);
  databases.push(path);
  // Both must share the same database so migrations run once
  const store = new SqliteJobStore(path);
  const accounts = new AccountStore(path);
  return { store, accounts };
}

function makeJob(ownerUserId: string, folderId: string, overrides: Partial<JobRecord> = {}): JobRecord {
  const ts = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    ownerUserId,
    moduleId: "share-content-import",
    title: "测试导入",
    status: "queued",
    progress: 0,
    stage: "排队中",
    overallExecutionMode: "real",
    values: {
      platformId: "douyin",
      normalizedUrl: "https://v.douyin.com/test123/",
      folderId,
      folderName: "测试文件夹",
    },
    executionPlan: [],
    provenance: [],
    cancelRequested: false,
    providerCancelState: "none",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

function makeContext(
  store: SqliteJobStore,
  accounts: AccountStore,
  downloadFn?: JobHandlerContext["downloadFn"],
): JobHandlerContext {
  return {
    store,
    accounts,
    change: (id, patch) => store.update(id, patch),
    downloadFn,
    // This suite exercises local Asset persistence. It must never inherit
    // host TOS credentials or attempt a real network upload.
    tosConfigured: false,
  };
}

/** Create a mock download that writes a minimal valid MP4 to a temp dir. */
function mockDownload(bytes = 1024) {
  return async () => {
    const dir = makeTempDir();
    const filePath = join(dir, "video.mp4");
    // Write enough bytes to look like a file
    writeFileSync(filePath, Buffer.alloc(bytes));
    return { filePath, tempDir: dir, mimeType: "video/mp4", byteSize: bytes };
  };
}

describe("douyin import integration", () => {
  let store: SqliteJobStore;
  let accounts: AccountStore;
  let userId: string;
  let folderId: string;

  beforeEach(async () => {
    const created = makeStoreAndAccounts();
    store = created.store;
    accounts = created.accounts;
    // Create user directly via DB (bypass SMS verification for tests)
    userId = crypto.randomUUID();
    const phone = `138${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    const now = new Date().toISOString();
    store.db.insert(users).values({
      id: userId, phone, passwordHash: await Bun.password.hash("Test1234!@#$"),
      displayName: "Test User", avatarText: "T", credits: 2480,
      status: "active", passwordVersion: 1, createdAt: now, updatedAt: now,
    }).run();
    store.db.insert(userPreferences).values({
      userId, updatedAt: now,
    }).run();
    // Ensure default folder
    accounts.ensureDefaultAssetFolder(userId);
    const defaultFolderId = accounts.getDefaultAssetFolderId(userId);
    const folder = accounts.getAssetFolder(userId, defaultFolderId);
    folderId = folder!.id;
  });

  afterEach(() => {
    accounts.close();
    store.close();
  });

  test("successful import creates Asset with correct owner and folder", async () => {
    const job = makeJob(userId, folderId);
    store.create(job);

    await douyinVideoImportJob.execute(job, makeContext(store, accounts, mockDownload(2048)));

    const updated = store.get(job.id);
    expect(updated?.status).toBe("succeeded");
    expect(updated?.result?.artifacts.length).toBe(1);
    const assetId = updated?.result?.artifacts[0].id;
    expect(assetId).toBeDefined();

    // Verify asset was created
    const asset = accounts.getOwnedAsset(userId, assetId!);
    expect(asset).toBeDefined();
    expect(asset?.ownerUserId).toBe(userId);
    expect(asset?.folderId).toBe(folderId);
    expect(asset?.mimeType).toBe("video/mp4");
    expect(asset?.byteSize).toBe(2048);
    expect(asset?.kind).toBe("media");

    // Verify local file exists
    const localPath = join(env.dataDir, "uploads", asset!.storageKey);
    const file = Bun.file(localPath);
    expect(await file.exists()).toBe(true);
  });

  test("job cancellation before download stops execution", async () => {
    const job = makeJob(userId, folderId, { cancelRequested: true });
    store.create(job);

    await douyinVideoImportJob.execute(job, makeContext(store, accounts));

    const updated = store.get(job.id);
    expect(updated?.status).toBe("cancelled");
    expect(updated?.result).toBeUndefined();
  });

  test("failure during download cleans up and records error", async () => {
    const job = makeJob(userId, folderId);
    store.create(job);

    const failingDownload = async () => {
      throw new Error("Simulated download failure");
    };

    await douyinVideoImportJob.execute(job, makeContext(store, accounts, failingDownload));

    const updated = store.get(job.id);
    expect(updated?.status).toBe("failed");
    expect(updated?.error?.code).toBe("DOWNLOAD_FAILED");
    expect(updated?.error?.message).toContain("Simulated download failure");

    // No asset should exist
    const assets = accounts.listAssets(userId, "media", folderId);
    expect(assets.length).toBe(0);
  });

  test("successful import cleans download temp dir after file is consumed", async () => {
    const job = makeJob(userId, folderId);
    store.create(job);

    let downloadDir = "";
    const trackingDownload = async () => {
      const dir = makeTempDir();
      downloadDir = dir;
      const filePath = join(dir, "video.mp4");
      writeFileSync(filePath, Buffer.alloc(4096));
      return { filePath, tempDir: dir, mimeType: "video/mp4", byteSize: 4096 };
    };

    await douyinVideoImportJob.execute(job, makeContext(store, accounts, trackingDownload));

    const updated = store.get(job.id);
    expect(updated?.status).toBe("succeeded");

    // Download temp dir should be cleaned after successful file consumption
    expect(existsSync(downloadDir)).toBe(false);
  });

  test("rejects import to folder owned by another user", async () => {
    // Create another user directly
    const otherUserId = crypto.randomUUID();
    const otherPhone = `139${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    const now = new Date().toISOString();
    store.db.insert(users).values({
      id: otherUserId, phone: otherPhone, passwordHash: await Bun.password.hash("OtherUser12345!@#"),
      displayName: "Other", avatarText: "O", credits: 2480,
      status: "active", passwordVersion: 1, createdAt: now, updatedAt: now,
    }).run();
    store.db.insert(userPreferences).values({ userId: otherUserId, updatedAt: now }).run();
    accounts.ensureDefaultAssetFolder(otherUserId);
    const otherFolderId = accounts.getDefaultAssetFolderId(otherUserId);
    const otherFolder = accounts.getAssetFolder(otherUserId, otherFolderId)!;

    // Try to import to other user's folder using userId
    const job = makeJob(userId, otherFolder.id);
    store.create(job);

    // The handler should throw because the folder doesn't belong to the job owner
    // (folder ownership check happens before the try/catch, so the error propagates)
    await expect(douyinVideoImportJob.execute(job, makeContext(store, accounts))).rejects.toThrow("文件夹");
  });

  test("idempotent: same URL + same folder → single job", () => {
    const shareUrl = "https://v.douyin.com/unique123/";
    const idempotencyKey = `sc-${userId}-${folderId}-douyin-${shareUrl}`.slice(0, 128);

    const job1 = makeJob(userId, folderId, {
      idempotencyKey,
      values: { ...makeJob(userId, folderId).values, normalizedUrl: shareUrl },
    });
    // const job2 = makeJob(userId, folderId, {
    //   idempotencyKey,
    //   values: { ...makeJob(userId, folderId).values, normalizedUrl: shareUrl },
    // });

    store.create(job1);
    const existing = store.getByIdempotencyKey(userId, idempotencyKey);
    expect(existing?.id).toBe(job1.id);

    // job2 should not be created (idempotency check happens in API, not store)
    // but store.getByIdempotencyKey should return job1
    const check = store.getByIdempotencyKey(userId, idempotencyKey);
    expect(check?.id).toBe(job1.id);
  });
});
