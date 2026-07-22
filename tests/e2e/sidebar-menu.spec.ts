import { expect, test } from "@playwright/test";
import { registerFromAuthScreen } from "./auth-helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  if (
    await page
      .getByRole("button", { name: "注册", exact: true })
      .isVisible()
      .catch(() => false)
  )
    await registerFromAuthScreen(page, "菜单测试用户", "MenuTest2026");
});

test("hides disabled features by default and persists an explicit show override", async ({ page }) => {
  await expect(page.getByText("视频剪辑", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "编辑菜单" }).click();
  const editorItem = page.locator('fieldset[aria-label="编辑视频剪辑"]');
  await expect(editorItem).toBeVisible();
  await expect(editorItem).toHaveClass(/hidden-item/);
  await editorItem.getByRole("button", { name: "显示视频剪辑" }).click();
  await expect(editorItem).not.toHaveClass(/hidden-item/);
  await page.getByRole("button", { name: "完成菜单编辑" }).click();

  await expect(page.getByRole("button", { name: "视频剪辑 Coming Soon" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "视频剪辑 Coming Soon" })).toBeVisible();

  await page.goto("/utilities/video-editor");
  await expect(page.locator('.coming-soon-page[data-module-id="video-editor"]')).toBeVisible();
});
