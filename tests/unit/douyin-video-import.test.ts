import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { AccountStore } from "../../server/accounts/account-store";
import {
  assertImportAuthorization,
  DouyinImportError,
  parseDouyinShareUrl,
  persistImportVideo,
  validateFullResponse,
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

describe("Douyin share text parsing", () => {
  test("extracts the douyin URL from a full pasted share message", () => {
    const text = "4.17 复制打开抖音，看看【创作者】的作品 春日花海  https://v.douyin.com/dZKNZs4U3DI/ 05/10@抖音";
    const url = parseDouyinShareUrl(text);
    expect(url.href).toBe("https://v.douyin.com/dZKNZs4U3DI/");
    expect(url.hostname).toBe("v.douyin.com");
  });

  test("accepts raw HTTPS douyin URLs unchanged", () => {
    expect(parseDouyinShareUrl("https://v.douyin.com/abc").href).toBe("https://v.douyin.com/abc");
    expect(parseDouyinShareUrl("https://www.douyin.com/video/456").hostname).toBe("www.douyin.com");
  });

  test("rejects text with zero douyin URLs", () => {
    expect(() => parseDouyinShareUrl("这是一段没有链接的分享文字")).toThrow(DouyinImportError);
  });

  test("rejects text containing only non-douyin HTTPS URLs", () => {
    expect(() => parseDouyinShareUrl("请看 https://example.com/video 这个视频")).toThrow(DouyinImportError);
  });

  test("rejects text containing an http (non-HTTPS) douyin URL", () => {
    expect(() => parseDouyinShareUrl("请看 http://v.douyin.com/abc 这个")).toThrow(DouyinImportError);
  });

  test("rejects text containing multiple allowlisted douyin URLs", () => {
    const text = "视频1 https://v.douyin.com/aaa111/ 和 视频2 https://v.douyin.com/bbb222/ 请选一个";
    expect(() => parseDouyinShareUrl(text)).toThrow("分享文本包含多个抖音链接");
  });

  test("deduplicates identical douyin URLs in text", () => {
    const text = "同一个链接出现了两次 https://v.douyin.com/dup123/  https://v.douyin.com/dup123/";
    const url = parseDouyinShareUrl(text);
    expect(url.href).toBe("https://v.douyin.com/dup123/");
  });

  test("ignores non-douyin URLs and extracts the single douyin URL", () => {
    const text = "请看 https://example.com/other 和 https://v.douyin.com/main456/?x=1 对比";
    const url = parseDouyinShareUrl(text);
    expect(url.href).toBe("https://v.douyin.com/main456/?x=1");
  });
});

describe("Full response validation", () => {
  const mp4Headers = { "content-type": "video/mp4", "content-length": "1024" };

  test("accepts a complete 200 MP4 response with matching length", () => {
    expect(() => validateFullResponse({ status: 200, headers: mp4Headers, byteLength: 1024 })).not.toThrow();
  });

  test("rejects a 206 partial content response", () => {
    expect(() => validateFullResponse({ status: 206, headers: mp4Headers, byteLength: 1024 })).toThrow(
      "平台返回了部分视频内容（206）",
    );
  });

  test("rejects a response with Content-Range header", () => {
    expect(() =>
      validateFullResponse({
        status: 200,
        headers: { ...mp4Headers, "content-range": "bytes 0-511/1024" },
        byteLength: 512,
      }),
    ).toThrow("平台返回了分段视频内容（Content-Range）");
  });

  test("rejects a response without content-length", () => {
    expect(() =>
      validateFullResponse({
        status: 200,
        headers: { "content-type": "video/mp4" },
        byteLength: 1024,
      }),
    ).toThrow("无法确认视频大小");
  });

  test("rejects non-MP4 content type", () => {
    expect(() =>
      validateFullResponse({
        status: 200,
        headers: { "content-type": "application/octet-stream", "content-length": "1024" },
        byteLength: 1024,
      }),
    ).toThrow("仅支持导入 MP4 视频");
  });

  test("rejects content-length exceeding 500MB", () => {
    expect(() =>
      validateFullResponse({
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": "524288001" },
        byteLength: 8,
      }),
    ).toThrow("视频超过 500MB");
  });

  test("rejects zero-length body", () => {
    expect(() => validateFullResponse({ status: 200, headers: mp4Headers, byteLength: 0 })).toThrow(
      "未获取到有效视频内容",
    );
  });

  test("rejects byte length exceeding 500MB regardless of declared length", () => {
    expect(() =>
      validateFullResponse({
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": "1024" },
        byteLength: 500 * 1024 * 1024 + 1,
      }),
    ).toThrow("视频超过 500MB");
  });

  test("rejects 200 response whose byte length is shorter than Content-Length", () => {
    expect(() =>
      validateFullResponse({
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": "2048" },
        byteLength: 1024,
      }),
    ).toThrow("视频实际大小");
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
    if (!row) throw new Error("AC-003 persistence test: asset not found in media_assets after persistImportVideo");
    expect(row.owner_user_id).toBe(TEST_USER_ID);
    expect(row.asset_kind).toBe("media");
    expect(row.folder_id).toBe(TEST_FOLDER_ID);
    expect(row.byte_size).toBe(8);

    // File exists on disk
    const storageKey = row.storage_key as string;
    expect(storageKey).toStartWith("test/");
    expect(storageKey).toEndWith(".mp4");
    const file = Bun.file(resolve(TEST_DATA_DIR, "uploads", storageKey));
    expect(await file.exists()).toBe(true);
    expect(await file.arrayBuffer()).toHaveLength(8);
  });
});
