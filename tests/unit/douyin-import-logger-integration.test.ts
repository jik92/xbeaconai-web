import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountStore } from "../../server/accounts/account-store";
import type { ImportLogEvent, ImportStage } from "../../server/imports/import-logger";
import { SqliteJobStore } from "../../server/jobs/sqlite-job-store";
import { userPreferences, users } from "../../server/db/schema";
import type { JobRecord } from "../../server/types";
import { douyinVideoImportJob } from "../../worker/jobs/job-douyin-video-import";
import type { JobHandlerContext } from "../../worker/jobs/types";

const databases: string[] = [];
const tempDirs: string[] = [];
const capturedLogs: ImportLogEvent[] = [];
let originalConsoleLog: typeof console.log;

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
  const dir = mkdtempSync(join(tmpdir(), "dy-log-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeSharedStoreAndAccounts(): { store: SqliteJobStore; accounts: AccountStore } {
  const path = join(tmpdir(), `dy-log-integration-${crypto.randomUUID()}.sqlite`);
  databases.push(path);
  return { store: new SqliteJobStore(path), accounts: new AccountStore(path) };
}

function makeJob(ownerUserId: string, folderId: string): JobRecord {
  const ts = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    ownerUserId,
    moduleId: "share-content-import",
    title: "日志集成测试",
    status: "queued",
    progress: 0,
    stage: "排队中",
    overallExecutionMode: "real",
    values: {
      platformId: "douyin",
      normalizedUrl: "https://v.douyin.com/test123/",
      folderId,
      folderName: "测试",
    },
    executionPlan: [],
    provenance: [],
    cancelRequested: false,
    providerCancelState: "none",
    stagingKeys: [],
    jobSchemaVersion: 2,
    createdAt: ts,
    updatedAt: ts,
  };
}

function mockDownload(bytes = 4096) {
  return async () => {
    const dir = makeTempDir();
    const fp = join(dir, "video.mp4");
    writeFileSync(fp, Buffer.alloc(bytes));
    return { filePath: fp, tempDir: dir, mimeType: "video/mp4", byteSize: bytes };
  };
}

beforeAll(() => {
  originalConsoleLog = console.log;
  console.log = (line: string) => {
    const prefix = "[douyin-import] ";
    if (typeof line === "string" && line.startsWith(prefix)) {
      try {
        capturedLogs.push(JSON.parse(line.slice(prefix.length)));
      } catch {
        /* ok */
      }
    }
  };
});

afterAll(() => {
  console.log = originalConsoleLog;
});

beforeEach(() => {
  capturedLogs.length = 0;
});

describe("import logger integration", () => {
  let store: SqliteJobStore;
  let accounts: AccountStore;
  let userId: string;
  let folderId: string;
  let job: JobRecord;

  beforeEach(async () => {
    const created = makeSharedStoreAndAccounts();
    store = created.store;
    accounts = created.accounts;
    // Create user directly via DB (bypass SMS verification for tests)
    userId = crypto.randomUUID();
    const phone = `138${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    const now = new Date().toISOString();
    store.db.insert(users).values({
      id: userId, phone, passwordHash: await Bun.password.hash("LogTest12345!@#$"),
      displayName: "Logger Test", avatarText: "L", credits: 2480,
      status: "active", passwordVersion: 1, createdAt: now, updatedAt: now,
    }).run();
    store.db.insert(userPreferences).values({ userId, updatedAt: now }).run();
    accounts.ensureDefaultAssetFolder(userId);
    const f = accounts.getAssetFolder(userId, accounts.getDefaultAssetFolderId(userId));
    if (!f) throw new Error("default folder not found");
    folderId = f.id;
    job = makeJob(userId, folderId);
    store.create(job);
  });

  afterEach(() => {
    accounts.close();
    store.close();
  });

  function context(overrides?: Partial<JobHandlerContext>): JobHandlerContext {
    return {
      store,
      accounts,
      change: (id, p) => store.update(id, p),
      tosConfigured: false, // default: TOS not configured
      ...overrides,
    };
  }

  // ── TOS not configured ────────────────────────────────────────

  test("success path with TOS not configured emits tos_skip", async () => {
    await douyinVideoImportJob.execute(job, context({ downloadFn: mockDownload(2048) }));

    expect(store.get(job.id)?.status).toBe("succeeded");

    const stages = capturedLogs.map((l) => l.stage);
    expect(stages).toContain("download_start");
    expect(stages).toContain("download_complete");
    expect(stages).toContain("save_local_start");
    expect(stages).toContain("save_local_complete");
    expect(stages).toContain("tos_skip");
    expect(stages).not.toContain("tos_upload_start");
    expect(stages).toContain("asset_created");
    expect(stages).toContain("success");
    expect(stages).toContain("cleanup");

    for (const log of capturedLogs) {
      expect(log.jobId).toBe(job.id);
    }

    const dlLog = capturedLogs.find((l) => l.stage === "download_complete");
    expect(dlLog?.fileSizeBytes).toBe(2048);
    const assetLog = capturedLogs.find((l) => l.stage === "asset_created");
    expect(assetLog?.fileSizeBytes).toBe(2048);
  });

  // ── TOS configured: upload success ────────────────────────────

  test("success path with TOS upload success emits tos_upload_start → tos_upload_complete", async () => {
    let uploadedPath = "";
    await douyinVideoImportJob.execute(
      job,
      context({
        downloadFn: mockDownload(4096),
        tosConfigured: true,
        tosUploadFn: async (filePath) => {
          uploadedPath = filePath;
        },
      }),
    );

    expect(store.get(job.id)?.status).toBe("succeeded");
    expect(uploadedPath).toBeTruthy();

    const stages = capturedLogs.map((l) => l.stage);
    expect(stages).toContain("tos_upload_start");
    expect(stages).toContain("tos_upload_complete");
    expect(stages).not.toContain("tos_skip");
    expect(stages).toContain("asset_created");
    expect(stages).toContain("success");
  });

  // ── TOS configured: upload failure ────────────────────────────

  test("TOS upload failure makes job failed and emits tos_upload_failure", async () => {
    let deletedKey = "";
    await douyinVideoImportJob.execute(
      job,
      context({
        downloadFn: mockDownload(1024),
        tosConfigured: true,
        tosUploadFn: async () => {
          throw new Error("Simulated TOS upload failure");
        },
        tosDeleteFn: async (key) => {
          deletedKey = key;
        },
      }),
    );

    expect(store.get(job.id)?.status).toBe("failed");

    const stages = capturedLogs.map((l) => l.stage);
    expect(stages).toContain("tos_upload_start");
    expect(stages).toContain("tos_upload_failure");
    expect(stages).toContain("failure");
    expect(stages).not.toContain("asset_created");
    expect(stages).not.toContain("success");

    // Cleanup must have been attempted
    expect(deletedKey).toBeTruthy();
  });

  // ── Failure redaction ─────────────────────────────────────────

  test("failure path redacts URLs from error messages", async () => {
    const failingDl = async () => {
      throw new Error("Download failed: https://v26-web.douyinvod.com/secret/video.mp4");
    };

    await douyinVideoImportJob.execute(job, context({ downloadFn: failingDl }));

    expect(store.get(job.id)?.status).toBe("failed");

    const failLogs = capturedLogs.filter((l) => l.stage === "failure");
    expect(failLogs.length).toBe(1);
    const raw = JSON.stringify(failLogs[0]);
    expect(raw).not.toContain("douyinvod.com");
    expect(raw).not.toContain("https://");
    expect(raw).toContain("[REDACTED_URL]");
    expect(failLogs[0].jobId).toBe(job.id);
    expect(failLogs[0].errorCode).toBeTruthy();
  });

  // ── Cancel ────────────────────────────────────────────────────

  test("cancel path emits cancel log", async () => {
    store.update(job.id, { cancelRequested: true });
    await douyinVideoImportJob.execute(job, context());
    const cancelLogs = capturedLogs.filter((l) => l.stage === "cancel");
    expect(cancelLogs.length).toBeGreaterThanOrEqual(1);
    expect(cancelLogs[0].jobId).toBe(job.id);
  });

  // ── Stage validity and field safety ───────────────────────────

  test("all log stages are valid ImportStage values", () => {
    const validStages: ImportStage[] = [
      "download_start",
      "download_complete",
      "download_failure",
      "probe_start",
      "probe_complete",
      "probe_failure",
      "save_local_start",
      "save_local_complete",
      "save_local_failure",
      "tos_upload_start",
      "tos_upload_complete",
      "tos_upload_failure",
      "tos_skip",
      "asset_created",
      "asset_create_failure",
      "success",
      "failure",
      "cancel",
      "cleanup",
    ];
    for (const log of capturedLogs) {
      expect(validStages).toContain(log.stage);
    }
  });

  test("no log contains URL, cookie, header, or token field names", async () => {
    await douyinVideoImportJob.execute(job, context({ downloadFn: mockDownload(1024) }));

    for (const log of capturedLogs) {
      const raw = JSON.stringify(log);
      expect(raw).not.toContain('"url"');
      expect(raw).not.toContain('"shareUrl"');
      expect(raw).not.toContain('"cookie"');
      expect(raw).not.toContain('"token"');
      expect(raw).not.toContain('"header"');
      expect(raw).not.toContain('"referer"');
      expect(raw).not.toContain('"userAgent"');
      expect(raw).toContain('"jobId"');
    }
  });

  test("each log has required fields: jobId, stage, result, durationMs", async () => {
    await douyinVideoImportJob.execute(job, context({ downloadFn: mockDownload(2048) }));

    expect(capturedLogs.length).toBeGreaterThan(0);
    for (const log of capturedLogs) {
      expect(typeof log.jobId).toBe("string");
      expect(log.jobId).toBe(job.id);
      expect(typeof log.stage).toBe("string");
      expect(log.stage.length).toBeGreaterThan(0);
      expect(["ok", "error"]).toContain(log.result);
      expect(typeof log.durationMs).toBe("number");
    }
  });
});
