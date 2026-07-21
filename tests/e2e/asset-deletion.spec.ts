import { expect, test } from "@playwright/test";
import { registerFromAuthScreen } from "./auth-helpers";

const pngFixture = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test.beforeEach(async ({ page }) => {
  await page.goto("/assets/materials");
  if (
    await page
      .getByRole("button", { name: "注册", exact: true })
      .isVisible()
      .catch(() => false)
  ) {
    await registerFromAuthScreen(page, "资产删除测试用户", "AssetDelete2026");
    await page.goto("/assets/materials");
  }
});

test("deletes uploaded media and complete products", async ({ page }) => {
  await page.route("**/api/uploads/direct", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "DIRECT_UPLOAD_UNAVAILABLE", message: "test fallback" } }),
    }),
  );

  await page.getByRole("button", { name: "上传素材" }).click();
  await page.locator('.asset-upload-modal input[type="file"]').setInputFiles({
    name: "deletion-media.png",
    mimeType: "image/png",
    buffer: pngFixture,
  });
  await page.getByRole("button", { name: "确认上传" }).click();
  await expect(page.getByText("deletion-media", { exact: true })).toBeVisible();
  const imagePreview = page.locator(".media-table-preview img");
  await expect(imagePreview).toHaveCSS("object-fit", "contain");
  const imageBox = await imagePreview.boundingBox();
  expect(imageBox?.width).toBe(imageBox?.height);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除 deletion-media" }).click();
  await expect(page.getByText("deletion-media", { exact: true })).toHaveCount(0);

  await page.goto("/assets/products");
  await page.getByRole("button", { name: "创建商品" }).click();
  const productModal = page.locator(".product-upload-modal");
  await productModal.locator('input[type="file"]').setInputFiles({
    name: "product.png",
    mimeType: "image/png",
    buffer: pngFixture,
  });
  await productModal.locator('input[maxlength="200"]').fill("待删除商品");
  await productModal.getByRole("button", { name: "确认上传" }).click();

  const detail = page.locator(".product-detail-modal");
  await expect(detail).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await detail.getByRole("button", { name: "删除商品" }).click();
  await expect(detail).toBeHidden();
  await expect(page.getByText("待删除商品", { exact: true })).toHaveCount(0);
});

test("shows a video frame before loading playback controls", async ({ page }) => {
  await page.route("**/api/uploads/direct", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "DIRECT_UPLOAD_UNAVAILABLE", message: "test fallback" } }),
    }),
  );
  await page.getByRole("button", { name: "上传素材" }).click();
  await page.locator('.asset-upload-modal input[type="file"]').setInputFiles({
    name: "preview-video.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("video-preview-fixture"),
  });
  await page.getByRole("button", { name: "确认上传" }).click();

  const preview = page.locator(".media-table-preview.video");
  await expect(preview).toBeVisible();
  await expect(preview.locator("video")).not.toHaveAttribute("controls", "");
  await preview.hover();
  const play = preview.getByRole("button", { name: "播放 preview-video" });
  await expect(play).toBeVisible();
  await play.click();
  await expect(preview.locator("video")).toHaveAttribute("controls", "");
  await expect(preview.locator("video")).toHaveCSS("object-fit", "contain");
});

test("keeps an authenticated preview mounted when the material table rerenders", async ({ page }) => {
  await page.route("**/api/uploads/direct", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "DIRECT_UPLOAD_UNAVAILABLE", message: "test fallback" } }),
    }),
  );
  let previewRequests = 0;
  page.on("request", (request) => {
    if (/\/api\/assets\/[^/]+\/content(?:\?|$)/.test(request.url())) previewRequests += 1;
  });

  await page.getByRole("button", { name: "上传素材" }).click();
  await page.locator('.asset-upload-modal input[type="file"]').setInputFiles({
    name: "stable-preview.png",
    mimeType: "image/png",
    buffer: pngFixture,
  });
  await page.getByRole("button", { name: "确认上传" }).click();

  const preview = page.locator(".media-table-preview img");
  await expect(preview).toBeVisible();
  await expect.poll(() => previewRequests).toBeGreaterThan(0);
  await page.waitForTimeout(200);
  const settledPreviewRequests = previewRequests;
  await preview.evaluate((node) => {
    (window as Window & { __stableAssetPreview?: Element }).__stableAssetPreview = node;
  });

  await page.getByPlaceholder("搜索素材库名称或描述…").fill("stable-preview");
  await expect(page.getByText("stable-preview", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      preview.evaluate((node) => node === (window as Window & { __stableAssetPreview?: Element }).__stableAssetPreview),
    )
    .toBe(true);
  await page.waitForTimeout(200);
  expect(previewRequests).toBe(settledPreviewRequests);
});
