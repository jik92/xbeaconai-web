import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { MediaAsset } from "../../server/accounts/account-store";
import { createTestAccountStore, registerTestAccount } from "./account-test-helper";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("product library", () => {
  test("binds multiple ordered images to one product", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "yaozuo-product-test-"));
    temporaryDirectories.push(directory);
    const store = createTestAccountStore(resolve(directory, "test.sqlite"));
    const registration = await registerTestAccount(store, {
      phone: "13800000001",
      password: "Test-password-123",
      displayName: "商品测试",
    });
    const createdAt = new Date().toISOString();
    const images: MediaAsset[] = ["主图.png", "侧面.png", "细节.png"].map((originalName, index) => ({
      id: crypto.randomUUID(),
      ownerUserId: registration.user.id,
      storageKey: `${index}.png`,
      originalName,
      mimeType: "image/png",
      byteSize: 100 + index,
      kind: "product",
      displayName: "草编礼帽",
      description: "卡其色草编平顶礼帽",
      createdAt,
    }));

    const productId = crypto.randomUUID();
    store.createProductAssets(
      {
        id: productId,
        ownerUserId: registration.user.id,
        name: "草编礼帽",
        description: "卡其色草编平顶礼帽",
        sharingScope: "team",
        createdAt,
      },
      images,
    );

    const products = store.listProducts(registration.user.id);
    expect(products).toHaveLength(1);
    expect(products[0]?.name).toBe("草编礼帽");
    expect(products[0]?.sharingScope).toBe("team");
    expect(products[0]?.images.map((image) => image.originalName)).toEqual(["主图.png", "侧面.png", "细节.png"]);
    const other = await registerTestAccount(store, {
      phone: "13800000002",
      password: "Test-password-123",
      displayName: "其他用户",
    });
    expect(() => store.deleteProduct(other.user.id, productId)).toThrow();
    expect(store.deleteProduct(registration.user.id, productId)).toHaveLength(3);
    expect(store.listProducts(registration.user.id)).toHaveLength(0);
    store.close();
  });
});
