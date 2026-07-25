import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountError } from "../../server/accounts/account-store";
import { createTestAccountStore, registerTestAccount } from "./account-test-helper";

const databases: string[] = [];
afterEach(() => {
  for (const path of databases.splice(0)) rmSync(path, { force: true });
});

describe("asset folder mapping", () => {
  test("keeps independent output folders for each AI tool and each account", async () => {
    const path = join(tmpdir(), `tool-output-folders-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const store = createTestAccountStore(path);
    const { user } = await registerTestAccount(store, {
      phone: "13800000013",
      password: "Password123",
      displayName: "工具目录用户",
    });
    const other = await registerTestAccount(store, {
      phone: "13800000014",
      password: "Password123",
      displayName: "其他工具目录用户",
    });
    store.listAssetFolders(user.id);
    const cutFolder = store.createAssetFolder(user.id, "分割成片");
    const voiceFolder = store.createAssetFolder(user.id, "音色成片");

    expect(store.getModuleOutputFolder(user.id, "video-cut")).toBeUndefined();
    expect(store.setModuleOutputFolder(user.id, "video-cut", cutFolder.id)?.id).toBe(cutFolder.id);
    expect(store.setModuleOutputFolder(user.id, "voice-clone", voiceFolder.id)?.id).toBe(voiceFolder.id);
    expect(store.getModuleOutputFolder(user.id, "video-cut")?.id).toBe(cutFolder.id);
    expect(store.getModuleOutputFolder(user.id, "voice-clone")?.id).toBe(voiceFolder.id);
    expect(() => store.setModuleOutputFolder(other.user.id, "video-cut", cutFolder.id)).toThrow(AccountError);

    expect(store.setModuleOutputFolder(user.id, "video-cut", undefined)).toBeUndefined();
    expect(store.getModuleOutputFolder(user.id, "video-cut")).toBeUndefined();
    store.setModuleOutputFolder(user.id, "video-cut", cutFolder.id);
    store.deleteAssetFolder(user.id, cutFolder.id);
    expect(store.getModuleOutputFolder(user.id, "video-cut")).toBeUndefined();
    expect(store.getModuleOutputFolder(user.id, "voice-clone")?.id).toBe(voiceFolder.id);
    store.close();
  });

  test("creates a user-scoped default folder and nested storage prefixes", async () => {
    const path = join(tmpdir(), `asset-folders-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const store = createTestAccountStore(path);
    const { user } = await registerTestAccount(store, {
      phone: "13800000003",
      password: "Password123",
      displayName: "目录用户",
    });

    const [defaultFolder] = store.listAssetFolders(user.id);
    expect(defaultFolder.name).toBe("默认");
    expect(defaultFolder.storagePrefix).toBe(`${user.id}/materials/${defaultFolder.id}/`);
    expect(store.getDefaultAssetFolderId(user.id)).toBe(defaultFolder.id);

    const child = store.createAssetFolder(user.id, "广告素材", defaultFolder.id);
    expect(child.parentId).toBe(defaultFolder.id);
    expect(child.storagePrefix).toBe(`${defaultFolder.storagePrefix}${child.id}/`);
    expect(store.setDefaultAssetFolder(user.id, child.id).id).toBe(child.id);
    expect(store.getDefaultAssetFolderId(user.id)).toBe(child.id);
    expect(() => store.deleteAssetFolder(user.id, child.id)).toThrowError(/其他文件夹设为默认/);

    store.createAsset({
      id: crypto.randomUUID(),
      ownerUserId: user.id,
      storageKey: `${child.storagePrefix}demo.mp4`,
      originalName: "demo.mp4",
      mimeType: "video/mp4",
      byteSize: 12,
      width: 1080,
      height: 1920,
      durationSec: 15,
      kind: "media",
      displayName: "demo",
      folderId: child.id,
      createdAt: new Date().toISOString(),
    });
    expect(store.listAssets(user.id, "media", child.id)).toMatchObject([
      { width: 1080, height: 1920, durationSec: 15 },
    ]);
    const [asset] = store.listAssets(user.id, "media", child.id);
    const other = await registerTestAccount(store, {
      phone: "13800000004",
      password: "Password123",
      displayName: "其他用户",
    });
    expect(() => store.deleteOwnedAsset(other.user.id, asset.id)).toThrow(AccountError);
    expect(store.deleteOwnedAsset(user.id, asset.id).id).toBe(asset.id);
    expect(store.listAssets(user.id, "media", child.id)).toHaveLength(0);
    store.setDefaultAssetFolder(user.id, defaultFolder.id);
    store.deleteAssetFolder(user.id, child.id);
    expect(() => store.deleteOwnedAsset(user.id, asset.id)).toThrow(AccountError);
    store.close();
  });
});
