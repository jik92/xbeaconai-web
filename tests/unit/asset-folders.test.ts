import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountError, AccountStore } from "../../server/accounts/account-store";

const databases: string[] = [];
afterEach(() => {
  for (const path of databases.splice(0)) rmSync(path, { force: true });
});

describe("asset folder mapping", () => {
  test("creates a user-scoped default folder and nested storage prefixes", async () => {
    const path = join(tmpdir(), `asset-folders-${crypto.randomUUID()}.sqlite`);
    databases.push(path);
    const store = new AccountStore(path);
    store.db.exec("CREATE TABLE jobs (id TEXT PRIMARY KEY, owner_user_id TEXT)");
    const { user } = await store.register({
      email: "folders@example.com",
      password: "Password123",
      displayName: "目录用户",
    });

    const [defaultFolder] = store.listAssetFolders(user.id);
    expect(defaultFolder.name).toBe("默认");
    expect(defaultFolder.storagePrefix).toBe(`${user.id}/materials/${defaultFolder.id}/`);

    const child = store.createAssetFolder(user.id, "广告素材", defaultFolder.id);
    expect(child.parentId).toBe(defaultFolder.id);
    expect(child.storagePrefix).toBe(`${defaultFolder.storagePrefix}${child.id}/`);

    store.createAsset({
      id: crypto.randomUUID(),
      ownerUserId: user.id,
      storageKey: `${child.storagePrefix}demo.mp4`,
      originalName: "demo.mp4",
      mimeType: "video/mp4",
      byteSize: 12,
      kind: "media",
      displayName: "demo",
      folderId: child.id,
      createdAt: new Date().toISOString(),
    });
    expect(store.listAssets(user.id, "media", child.id)).toHaveLength(1);
    expect(() => store.deleteAssetFolder(user.id, child.id)).toThrow(AccountError);
    store.db.close();
  });
});
