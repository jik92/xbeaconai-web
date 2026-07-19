import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { AccountStore } from "../../server/accounts/account-store";
import {
  assertImportAuthorization,
  DouyinImportError,
  parseDouyinShareUrl,
  persistImportVideo,
} from "../../server/imports/douyin-video";

const TEST_DATA_DIR = resolve(import.meta.dirname ?? ".", ".tmp-douyin-test");
const TEST_USER_ID = "aaaaaaaa-bbbb-cccc-dddd-000000000001";
const TEST_FOLDER_ID = "aaaaaaaa-bbbb-cccc-dddd-000000000002";

function setupAccountStore() {
  const dbPath = resolve(TEST_DATA_DIR, "test.db");
  mkdirSync(TEST_DATA_DIR, { recursive: true, mode: 0o700 });
  const store = new AccountStore(dbPath);
  // Create a minimal test user and folder so FK constraints are satisfied.
  store.db.run(
    "INSERT OR IGNORE INTO users(id,email,password_hash,display_name,avatar_text,credits,status,password_version,created_at,updated_at) VALUES(?,'test@test.example','hash','Test','T',100,'active',1,?,?)",
    [TEST_USER_ID, new Date().toISOString(), new Date().toISOString()],
  );
  store.db.run(
    "INSERT OR IGNORE INTO asset_folders(id,owner_user_id,name,storage_prefix,created_at,updated_at) VALUES(?,?,'test-folder','test/',?,?)",
    [TEST_FOLDER_ID, TEST_USER_ID, new Date().toISOString(), new Date().toISOString()],
  );
  return store;
}

describe("Douyin video import guards", () => {
  test("accepts HTTPS URLs from supported share hosts", () => {
    expect(parseDouyinShareUrl("https://v.douyin.com/example/?from=share").hostname).toBe("v.douyin.com");
    expect(parseDouyinShareUrl("https://www.douyin.com/video/123").hostname).toBe("www.douyin.com");
  });

  test("rejects non-HTTPS, arbitrary hosts, and malformed links before a browser opens", () => {
    for (const url of [
      "http://v.douyin.com/example",
      "https://example.com/video",
      "https://127.0.0.1/video",
      "not-a-url",
    ]) {
      expect(() => parseDouyinShareUrl(url)).toThrow(DouyinImportError);
    }
  });

  test("requires the user to confirm download authorization", () => {
    expect(() => assertImportAuthorization(false)).toThrow("请确认你拥有该视频的下载和使用授权");
    expect(() => assertImportAuthorization(true)).not.toThrow();
  });
});

describe("Douyin video import persistence", () => {
  let accounts: AccountStore;

  beforeAll(() => {
    accounts = setupAccountStore();
  });

  afterAll(() => {
    try {
      rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      /* clean up */
    }
  });

  test("persists an MP4 as the correct user's media asset in the target folder and returns the content URL", async () => {
    const fakeVideo = {
      bytes: new Uint8Array([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70]), // minimal FTYP box
      mimeType: "video/mp4" as const,
      sourceUrl: "https://v3-web.douyinvod.com/video/abc123",
    };

    const asset = await persistImportVideo(
      fakeVideo,
      TEST_USER_ID,
      { id: TEST_FOLDER_ID, storagePrefix: "test/" },
      "我的测试视频",
      {
        dataDir: TEST_DATA_DIR,
        accounts,
      },
    );

    // Returned shape
    expect(asset.id).toBeString();
    expect(asset.name).toBe("我的测试视频");
    expect(asset.originalName).toBe("我的测试视频.mp4");
    expect(asset.mimeType).toBe("video/mp4");
    expect(asset.size).toBe(8);
    expect(asset.kind).toBe("media");
    expect(asset.description).toBe("从抖音链接导入");
    expect(asset.folderId).toBe(TEST_FOLDER_ID);
    expect(asset.url).toBe(`/api/assets/${asset.id}/content`);
    expect(asset.createdAt).toBeString();

    // Persisted in database with correct ownership, folder and kind
    const row = accounts.db
      .query("SELECT owner_user_id, asset_kind, folder_id, byte_size, storage_key FROM media_assets WHERE id=?")
      .get(asset.id) as Record<string, unknown> | undefined;
    expect(row).not.toBeNull();
    expect(row!.owner_user_id).toBe(TEST_USER_ID);
    expect(row!.asset_kind).toBe("media");
    expect(row!.folder_id).toBe(TEST_FOLDER_ID);
    expect(row!.byte_size).toBe(8);

    // File exists on disk
    const storageKey = row!.storage_key as string;
    expect(storageKey).toStartWith("test/");
    expect(storageKey).toEndWith(".mp4");
    const file = Bun.file(resolve(TEST_DATA_DIR, "uploads", storageKey));
    expect(await file.exists()).toBe(true);
    expect(await file.arrayBuffer()).toHaveLength(8);
  });
});
